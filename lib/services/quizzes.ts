import { JobType, Prisma, QuestionType, QuizStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEmbed } from "@/lib/ai";
import { assertProjectAccess, assertQuizAccess } from "@/lib/auth/guards";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import { retrieveEvidence } from "@/lib/rag/retrieve";
import { generateQuizQuestion } from "@/lib/ai/features/generate-quiz";
import { gradeOpenEndedAnswer } from "@/lib/ai/features/grade-answer";
import { gradeMultipleChoice } from "@/lib/learning/grading";
import { planQuiz, type ConceptCandidate } from "@/lib/learning/selection";
import {
  ANSWER_PASS_THRESHOLD,
  QUIZ_LENGTH_DEFAULT,
  type AnswerResultView,
  type QuizModeValue,
  type QuizOption,
  type QuizSummary,
  type QuizView,
} from "@/lib/learning/quiz";
import { recomputeConceptMastery, type MasteryChange } from "@/lib/services/mastery";
import { enqueueJob } from "@/lib/jobs/queue";
import type { QuizAnswerInput, QuizCreateInput } from "@/lib/validation/quizzes";

/**
 * Quizzes — the assessment half of the learning loop.
 *
 * Every exported function takes `userId` first and resolves ownership before doing
 * anything, matching the other services.
 *
 * The shape of a turn is:
 *   plan (pure policy) → generate grounded questions → answer: deterministic or rubric
 *   grading → append `ConceptEvidence` → recompute `Concept.mastery` → activity events.
 *
 * All of that happens inside one transaction per answer, so mastery can never drift
 * from the evidence that justified it.
 */

/** Evidence older than this does not count towards "repeated mistakes". */
const MISTAKE_WINDOW_DAYS = 30;
const MISTAKE_SCORE_THRESHOLD = 0.5;

/** Evidence weight for a concept touched indirectly (covered/missing) by an answer. */
const SECONDARY_EVIDENCE_WEIGHT = 0.5;

/** Storage bounds for model-written grading prose. */
const MAX_FEEDBACK_CHARACTERS = 1_200;
const MAX_REASONING_CHARACTERS = 1_000;

export const QUIZ_JOB_IDS = {
  evaluate: (quizId: string) => `quiz:${quizId}:evaluate`,
};

type QuizWithQuestions = Prisma.QuizGetPayload<{
  include: {
    questions: {
      include: { concept: { select: { name: true } }; answer: true };
    };
  };
}>;

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toOptions(value: Prisma.JsonValue | null | undefined): QuizOption[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (typeof record.id === "string" && typeof record.text === "string") {
        return [{ id: record.id, text: record.text }];
      }
    }
    return [];
  });
}

function toQuizView(quiz: QuizWithQuestions): QuizView {
  return {
    id: quiz.id,
    projectId: quiz.projectId,
    mode: quiz.mode,
    status: quiz.status,
    title: quiz.title,
    startedAt: quiz.startedAt.toISOString(),
    completedAt: quiz.completedAt?.toISOString() ?? null,
    questions: quiz.questions.map((question) => {
      const answer = question.answer;

      return {
        id: question.id,
        ord: question.ord,
        type: question.type,
        difficulty: question.difficulty,
        prompt: question.prompt,
        conceptName: question.concept?.name ?? null,
        options: toOptions(question.options),
        answer: answer
          ? {
              isCorrect: answer.isCorrect,
              score: answer.score,
              feedback: answer.feedback,
              conceptsCovered: toStringArray(answer.conceptsCovered),
              conceptsMissing: toStringArray(answer.conceptsMissing),
              // The answer key is revealed only once the question has been answered.
              correctAnswer: question.correctAnswer,
              gradedBy: answer.gradedBy,
            }
          : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getQuiz(userId: string, quizId: string): Promise<QuizView> {
  await assertQuizAccess(userId, quizId);

  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { ord: "asc" },
        include: { concept: { select: { name: true } }, answer: true },
      },
    },
  });

  return toQuizView(quiz);
}

export async function listQuizzes(userId: string, projectId: string): Promise<QuizSummary[]> {
  const project = await assertProjectAccess(userId, projectId);

  const quizzes = await prisma.quiz.findMany({
    where: { projectId: project.id },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { questions: { select: { answer: { select: { score: true } } } } },
  });

  return quizzes.map((quiz) => {
    const scores = quiz.questions
      .map((question) => question.answer?.score)
      .filter((score): score is number => typeof score === "number");

    return {
      id: quiz.id,
      mode: quiz.mode,
      status: quiz.status,
      title: quiz.title,
      startedAt: quiz.startedAt.toISOString(),
      completedAt: quiz.completedAt?.toISOString() ?? null,
      questionCount: quiz.questions.length,
      answeredCount: scores.length,
      averageScore:
        scores.length > 0
          ? scores.reduce((total, score) => total + score, 0) / scores.length
          : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startQuiz(userId: string, input: QuizCreateInput): Promise<QuizView> {
  const project = await assertProjectAccess(userId, input.projectId);

  const concepts = await prisma.concept.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true, description: true, importance: true, mastery: true },
    orderBy: { name: "asc" },
  });

  if (concepts.length === 0) {
    throw new ConflictError(
      "This project has no concepts yet. Questions are generated from your own material, so upload and process a document first.",
    );
  }

  const since = new Date(Date.now() - MISTAKE_WINDOW_DAYS * 86_400_000);

  // Two grouped reads rather than per-concept queries: the candidate set is small, but
  // this keeps the cost flat as a project accumulates concepts.
  const [lastPractised, mistakeCounts] = await Promise.all([
    prisma.conceptEvidence.groupBy({
      by: ["conceptId"],
      where: { projectId: project.id },
      _max: { createdAt: true },
    }),
    prisma.conceptEvidence.groupBy({
      by: ["conceptId"],
      where: {
        projectId: project.id,
        createdAt: { gte: since },
        score: { lt: MISTAKE_SCORE_THRESHOLD },
      },
      _count: { _all: true },
    }),
  ]);

  const lastByConcept = new Map(lastPractised.map((row) => [row.conceptId, row._max.createdAt]));
  const mistakesByConcept = new Map(mistakeCounts.map((row) => [row.conceptId, row._count._all]));

  const candidates: ConceptCandidate[] = concepts.map((concept) => ({
    id: concept.id,
    name: concept.name,
    importance: concept.importance,
    mastery: concept.mastery,
    lastPracticedAt: lastByConcept.get(concept.id) ?? null,
    recentMistakes: mistakesByConcept.get(concept.id) ?? 0,
  }));

  const mode: QuizModeValue = input.mode ?? "QUIZ";
  const length = input.length ?? QUIZ_LENGTH_DEFAULT;
  const plans = planQuiz({ candidates, length, mode });

  // Resolved up front, in plan order, so the questions end up in the same sequence the
  // policy chose and each question's `ord` is unchanged.
  type GeneratedDraft = {
    plan: ReturnType<typeof planQuiz>[number];
    question: Awaited<ReturnType<typeof generateQuizQuestion>>;
  };

  const planned: Array<{ plan: GeneratedDraft["plan"]; concept: (typeof concepts)[number] }> =
    plans.flatMap((plan) => {
      const concept = concepts.find((candidate) => candidate.id === plan.conceptId);
      return concept ? [{ plan, concept }] : [];
    });

  const queries = planned.map(({ concept }) =>
    `${concept.name}. ${concept.description ?? ""}`.trim(),
  );

  /*
   * One embedding call for every concept query, rather than one per question. Each
   * question is still grounded in its own concept's evidence; the vectors are simply
   * computed in a single model invocation rather than N separate ones.
   */
  const queryVectors =
    queries.length > 0
      ? await aiEmbed({ context: { userId, projectId: project.id }, inputs: queries })
      : [];

  /*
   * Questions are still generated one at a time.
   *
   * Generating them concurrently is roughly three times faster in isolation, but it was
   * measured to be unsafe here for two independent reasons: the configured provider tier
   * enforces a tokens-per-minute budget that concurrent prompts overrun (a 429 instead of
   * a question, when the learner has just been using the Tutor), and it breaks the
   * evaluation suite's assessment checks. Neither is worth the latency.
   *
   * What *is* safe — and what changed — is that every concept's query is embedded in a
   * single model call above, instead of one call per concept.
   */
  const drafts: GeneratedDraft[] = [];

  for (const [index, { plan, concept }] of planned.entries()) {
    // Each question is grounded in its own concept's evidence. A concept the material
    // does not cover is skipped rather than turned into a fabricated question.
    const evidence = await retrieveEvidence({
      userId,
      projectId: project.id,
      query: queries[index]!,
      queryEmbedding: queryVectors[index],
      topK: 4,
    });

    if (evidence.length === 0) continue;

    const question = await generateQuizQuestion(
      { userId, projectId: project.id },
      {
        project: { name: project.name, description: project.description, goal: project.goal },
        concept: {
          name: concept.name,
          description: concept.description,
          mastery: concept.mastery,
        },
        type: plan.type,
        difficulty: plan.difficulty,
        evidence,
      },
    );

    drafts.push({ plan, question });
  }

  if (drafts.length === 0) {
    throw new ConflictError(
      "None of this project's concepts could be grounded in your materials, so no questions could be generated. Upload more material and try again.",
    );
  }

  const quiz = await prisma.$transaction(async (tx) => {
    const created = await tx.quiz.create({
      data: {
        projectId: project.id,
        mode,
        status: QuizStatus.IN_PROGRESS,
        title: `${drafts.length}-question ${mode === "ASSESSMENT" ? "assessment" : "quiz"}`,
      },
    });

    for (const [index, draft] of drafts.entries()) {
      await tx.quizQuestion.create({
        data: {
          quizId: created.id,
          conceptId: draft.plan.conceptId,
          type:
            draft.plan.type === "MULTIPLE_CHOICE"
              ? QuestionType.MULTIPLE_CHOICE
              : QuestionType.OPEN_ENDED,
          difficulty: draft.plan.difficulty,
          prompt: draft.question.prompt,
          options: draft.question.options
            ? (draft.question.options as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          correctAnswer: draft.question.correctAnswer,
          explanation: draft.question.explanation,
          ord: index,
        },
      });
    }

    await recordActivity(tx, {
      userId,
      type: ActivityType.QUIZ_STARTED,
      spaceId: project.spaceId,
      projectId: project.id,
      payload: { quizId: created.id, mode, questions: drafts.length },
    });

    return created;
  });

  return getQuiz(userId, quiz.id);
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

export type SubmitAnswerResult = {
  result: AnswerResultView;
  mastery: MasteryChange[];
};

type GradeOutcome = {
  isCorrect: boolean;
  score: number;
  feedback: string;
  conceptsCovered: string[];
  conceptsMissing: string[];
  reasoning: string | null;
  gradedBy: string;
};

export async function submitAnswer(
  userId: string,
  quizId: string,
  input: QuizAnswerInput,
): Promise<SubmitAnswerResult> {
  const quiz = await assertQuizAccess(userId, quizId);

  if (quiz.status !== QuizStatus.IN_PROGRESS) {
    throw new ConflictError("This quiz has already been completed.");
  }

  const question = await prisma.quizQuestion.findFirst({
    where: { id: input.questionId, quizId: quiz.id },
    include: {
      concept: { select: { id: true, name: true, description: true } },
      answer: { select: { id: true } },
    },
  });

  if (!question) throw new NotFoundError("Question");

  // QuizAnswer.questionId is unique, so a re-answer would fail at the database anyway.
  // Checking first turns that into a clear message rather than a constraint error.
  if (question.answer) throw new ConflictError("That question has already been answered.");

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: quiz.projectId },
    select: { id: true, spaceId: true, name: true, description: true, goal: true },
  });

  const outcome =
    question.type === QuestionType.MULTIPLE_CHOICE
      ? gradeChoice(question, input.answer)
      : await gradeWritten(userId, project, question, input.answer);

  const conceptNames = [...outcome.conceptsCovered, ...outcome.conceptsMissing];
  const projectConcepts =
    conceptNames.length > 0
      ? await prisma.concept.findMany({
          where: { projectId: project.id },
          select: { id: true, name: true },
        })
      : [];

  const conceptIdByName = new Map(
    projectConcepts.map((concept) => [concept.name.toLowerCase(), concept.id]),
  );

  // The question's own concept carries the full weight; concepts merely mentioned by an
  // open-ended answer carry half, because the attribution is weaker.
  const evidence: Array<{ conceptId: string; score: number; weight: number }> = [];

  if (question.conceptId) {
    evidence.push({ conceptId: question.conceptId, score: outcome.score, weight: 1 });
  }

  if (question.type === QuestionType.OPEN_ENDED) {
    for (const name of outcome.conceptsCovered) {
      const conceptId = conceptIdByName.get(name.toLowerCase());
      if (conceptId && conceptId !== question.conceptId) {
        evidence.push({ conceptId, score: 1, weight: SECONDARY_EVIDENCE_WEIGHT });
      }
    }

    for (const name of outcome.conceptsMissing) {
      const conceptId = conceptIdByName.get(name.toLowerCase());
      if (conceptId && conceptId !== question.conceptId) {
        evidence.push({ conceptId, score: 0, weight: SECONDARY_EVIDENCE_WEIGHT });
      }
    }
  }

  const mastery = await prisma.$transaction(async (tx) => {
    await tx.quizAnswer.create({
      data: {
        questionId: question.id,
        userAnswer: input.answer,
        isCorrect: outcome.isCorrect,
        score: outcome.score,
        feedback: outcome.feedback,
        conceptsCovered: outcome.conceptsCovered as unknown as Prisma.InputJsonValue,
        conceptsMissing: outcome.conceptsMissing as unknown as Prisma.InputJsonValue,
        reasoning: outcome.reasoning,
        gradedBy: outcome.gradedBy,
      },
    });

    const changes: MasteryChange[] = [];

    for (const row of evidence) {
      await tx.conceptEvidence.create({
        data: {
          projectId: project.id,
          conceptId: row.conceptId,
          source: "QUIZ_ANSWER",
          score: row.score,
          weight: row.weight,
          metadata: {
            quizId: quiz.id,
            questionId: question.id,
            gradedBy: outcome.gradedBy,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      changes.push(await recomputeConceptMastery(tx, row.conceptId));
    }

    await recordActivity(tx, {
      userId,
      type: ActivityType.ANSWER_GRADED,
      spaceId: project.spaceId,
      projectId: project.id,
      payload: {
        quizId: quiz.id,
        questionId: question.id,
        isCorrect: outcome.isCorrect,
        gradedBy: outcome.gradedBy,
      },
    });

    const moved = changes.filter((change) => change.before !== change.after);

    if (moved.length > 0) {
      await recordActivity(tx, {
        userId,
        type: ActivityType.MASTERY_UPDATED,
        spaceId: project.spaceId,
        projectId: project.id,
        payload: {
          quizId: quiz.id,
          concepts: moved.map((change) => ({
            conceptId: change.conceptId,
            before: change.before,
            after: change.after,
          })),
        } as unknown as Prisma.InputJsonValue,
      });
    }

    return changes;
  });

  return {
    result: {
      isCorrect: outcome.isCorrect,
      score: outcome.score,
      feedback: outcome.feedback,
      conceptsCovered: outcome.conceptsCovered,
      conceptsMissing: outcome.conceptsMissing,
      correctAnswer: question.correctAnswer,
      gradedBy: outcome.gradedBy,
    },
    mastery,
  };
}

/** Multiple choice: a string comparison. No model call, and no way to be wrong. */
function gradeChoice(
  question: {
    correctAnswer: string | null;
    explanation: string | null;
    concept: { name: string } | null;
  },
  answer: string,
): GradeOutcome {
  const graded = gradeMultipleChoice({
    selectedOptionId: answer,
    correctAnswer: question.correctAnswer,
  });

  if (!graded) {
    // Generation refuses to store a multiple-choice question without a key, so this
    // means the row was corrupted rather than that the learner was wrong.
    throw new ConflictError("This question has no answer key and cannot be graded.");
  }

  const conceptName = question.concept?.name ?? null;
  const because = question.explanation ? `${question.explanation} ` : "";

  return {
    isCorrect: graded.isCorrect,
    score: graded.score,
    feedback: graded.isCorrect
      ? `${because}${conceptName ? `That is ${conceptName} applied correctly.` : "Correct."}`.trim()
      : `${because}${conceptName ? `This suggests ${conceptName} is worth another look.` : "That is not the correct option."}`.trim(),
    conceptsCovered: graded.isCorrect && conceptName ? [conceptName] : [],
    conceptsMissing: !graded.isCorrect && conceptName ? [conceptName] : [],
    reasoning: null,
    gradedBy: "deterministic",
  };
}

/** Open-ended: rubric grading, with the reference material supplied so it is grounded. */
async function gradeWritten(
  userId: string,
  project: { id: string; name: string; description: string; goal: string },
  question: {
    prompt: string;
    difficulty: number;
    concept: { name: string; description: string | null } | null;
  },
  answer: string,
): Promise<GradeOutcome> {
  const evidence = await retrieveEvidence({
    userId,
    projectId: project.id,
    query: question.concept
      ? `${question.concept.name}. ${question.concept.description ?? ""}`.trim()
      : question.prompt,
    topK: 4,
  });

  const grade = await gradeOpenEndedAnswer(
    { userId, projectId: project.id },
    {
      project: { name: project.name, description: project.description, goal: project.goal },
      concept: question.concept
        ? { name: question.concept.name, description: question.concept.description }
        : null,
      question: { prompt: question.prompt, difficulty: question.difficulty },
      answer,
      evidence,
    },
  );

  // The rubric's three dimensions collapse into the single stored score.
  const score = Number(((grade.understanding + grade.accuracy + grade.relevance) / 3).toFixed(4));

  return {
    isCorrect: score >= ANSWER_PASS_THRESHOLD,
    score,
    // Bounded here rather than in the schema: a hard `maxLength` the model overshoots is
    // rejected by the provider, whereas truncation is merely imperfect.
    feedback: grade.feedback.slice(0, MAX_FEEDBACK_CHARACTERS),
    conceptsCovered: grade.conceptsCovered,
    conceptsMissing: grade.conceptsMissing,
    reasoning: grade.reasoning.slice(0, MAX_REASONING_CHARACTERS),
    gradedBy: "ai",
  };
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export async function completeQuiz(userId: string, quizId: string): Promise<QuizView> {
  const quiz = await assertQuizAccess(userId, quizId);

  // Idempotent: completing twice is not an error, it just does not repeat the work.
  if (quiz.status !== QuizStatus.COMPLETED) {
    const [project, questions] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: quiz.projectId },
        select: { spaceId: true },
      }),
      prisma.quizQuestion.findMany({
        where: { quizId: quiz.id },
        select: { answer: { select: { score: true } } },
      }),
    ]);

    const scores = questions
      .map((question) => question.answer?.score)
      .filter((score): score is number => typeof score === "number");

    await prisma.$transaction(async (tx) => {
      await tx.quiz.update({
        where: { id: quiz.id },
        data: { status: QuizStatus.COMPLETED, completedAt: new Date() },
      });

      await recordActivity(tx, {
        userId,
        type: ActivityType.QUIZ_COMPLETED,
        spaceId: project.spaceId,
        projectId: quiz.projectId,
        payload: {
          quizId: quiz.id,
          answered: scores.length,
          questions: questions.length,
          averageScore:
            scores.length > 0
              ? Number(
                  (scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(4),
                )
              : null,
        },
      });
    });

    // Evaluation runs out of band: it must not hold up the response, and a failure is
    // retried by the queue rather than losing the learner's completion.
    await enqueueJob({
      type: JobType.QUIZ_EVALUATE,
      payload: { quizId: quiz.id },
      idempotencyKey: QUIZ_JOB_IDS.evaluate(quiz.id),
    });
  }

  return getQuiz(userId, quiz.id);
}

/**
 * The `quiz.evaluate` job body.
 *
 * Recomputes mastery for every concept the quiz touched. Idempotent by construction —
 * mastery is derived from evidence, so running it twice produces the same number.
 * Weakness detection, growth insight and recommendations are Phase 8 and extend here.
 */
export async function evaluateQuiz(quizId: string): Promise<{
  /** Null when the quiz has been deleted; the job then has nothing to follow up on. */
  projectId: string | null;
  concepts: number;
  changes: MasteryChange[];
}> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { projectId: true, questions: { select: { conceptId: true } } },
  });

  if (!quiz) return { projectId: null, concepts: 0, changes: [] };

  const conceptIds = [
    ...new Set(
      quiz.questions
        .map((question) => question.conceptId)
        .filter((conceptId): conceptId is string => Boolean(conceptId)),
    ),
  ];

  const changes: MasteryChange[] = [];

  for (const conceptId of conceptIds) {
    changes.push(await recomputeConceptMastery(prisma, conceptId));
  }

  return { projectId: quiz.projectId, concepts: conceptIds.length, changes };
}
