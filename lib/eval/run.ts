import { MaterialStatus, QuestionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { askTutor, type TutorEvent } from "@/lib/services/tutor";
import { retrieveEvidence } from "@/lib/rag/retrieve";
import { startQuiz } from "@/lib/services/quizzes";
import { generateForProject, listForProject } from "@/lib/services/recommendations";
import { gradeArtefact } from "@/lib/ai/features/eval-grade";
import { difficultyForMastery } from "@/lib/learning/selection";
import { buildReport, check, metric, type EvalCheck, type EvalReport } from "@/lib/eval/report";

/**
 * The four evaluation suites from §10.5.
 *
 * Run against a project, not against mocks: the point is to detect a change in prompt,
 * model, or retrieval behaviour, and a mocked harness would hide exactly that. Every check
 * records its evidence, so a failure says what it saw rather than only that it saw it.
 *
 * This is deliberately never on a learner's request path — it makes several model calls.
 */

/** A question no project's material should be able to answer. */
const OFF_TOPIC_QUESTION =
  "Explain the mating rituals of Antarctic krill using quantum field theory.";

/** Model-graded checks are advisory, so the bar is "clearly adequate", not "perfect". */
const MODEL_GRADE_FLOOR = 0.6;

async function collectTutorEvents(input: {
  userId: string;
  projectId: string;
  message: string;
}): Promise<TutorEvent[]> {
  const events: TutorEvent[] = [];

  for await (const event of askTutor(input.userId, {
    projectId: input.projectId,
    message: input.message,
  })) {
    events.push(event);
  }

  return events;
}

function answerFrom(events: TutorEvent[]): string {
  return events
    .filter((event) => event.type === "delta")
    .map((event) => (event.type === "delta" ? event.text : ""))
    .join("");
}

export async function runEvaluationSuites(projectId: string): Promise<EvalReport> {
  const startedAt = new Date();

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, goal: true, space: { select: { userId: true } } },
  });
  const userId = project.space.userId;

  const checks: EvalCheck[] = [];

  const material = await prisma.material.findFirst({
    where: { projectId, status: MaterialStatus.READY },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true },
  });

  const chunk = material
    ? await prisma.chunk.findFirst({
        where: { materialId: material.id },
        orderBy: { ord: "asc" },
        select: { content: true, page: true },
      })
    : null;

  // -------------------------------------------------------------------------
  // Tutor
  // -------------------------------------------------------------------------
  if (!material || !chunk) {
    checks.push(
      check(
        "tutor",
        "a processed material exists to evaluate against",
        false,
        "no READY material with chunks in this project — run `npm run eval` to provision the fixture",
      ),
    );
  } else {
    const question = `Explain what this passage means: ${chunk.content.slice(0, 300)}`;
    const events = await collectTutorEvents({ userId, projectId, message: question });

    const citationsEvent = events.find((event) => event.type === "citations");
    const citations = citationsEvent?.type === "citations" ? citationsEvent.citations : [];
    const answer = answerFrom(events);

    checks.push(
      check(
        "tutor",
        "a grounded answer cites the project's own material",
        citations.length > 0 && citations.some((citation) => citation.materialId === material.id),
        `${citations.length} citation(s), ${citations.map((citation) => `${citation.title} p.${citation.page}`).join("; ") || "none"}`,
      ),
    );

    if (answer.length > 0) {
      /*
       * Groundedness is judged against the evidence the Tutor was actually allowed to use,
       * not against the single passage the question quoted — the first version of this
       * check failed correct answers that cited the second and third retrieved passages.
       */
      const tutorEvidence = await retrieveEvidence({ userId, projectId, query: question });
      const reference =
        tutorEvidence.length > 0
          ? tutorEvidence.map((entry) => entry.content).join("\n\n")
          : chunk.content;

      const grade = await gradeArtefact(
        { userId, projectId },
        {
          /*
           * The criterion mirrors the Tutor's actual contract (§7.2): answer from the
           * project's evidence, cite it, and refuse when the evidence does not support an
           * answer. It deliberately does **not** demand that every sentence be a quotation
           * — an earlier version did, and scored 0.40 on an answer that was correctly
           * cited and merely explained what it had read. What is being detected is
           * invention, not exposition.
           */
          criterion:
            "the answer's factual claims about the subject come from the reference material, it contradicts nothing in it, and it does not present outside knowledge as though it came from the material. Explaining and connecting the material is expected; inventing specifics is not",
          task: question,
          artefact: answer,
          reference,
        },
      );

      checks.push(
        // Model-graded: recorded and shown, but it cannot fail the run on its own.
        metric(
          "tutor",
          "the answer is grounded in the retrieved evidence (model-graded)",
          grade.score >= MODEL_GRADE_FLOOR,
          // The answer is included so a low score can be judged by a human rather than
          // taken on the grader's word.
          `score=${grade.score.toFixed(2)} over ${tutorEvidence.length} reference passage(s) — ${grade.verdict} | answer: ${answer.replace(/\s+/g, " ").slice(0, 220)}`,
        ),
      );
    } else {
      checks.push(check("tutor", "an answer was produced for an answerable question", false, "no answer text streamed"));
    }

    const refusalEvents = await collectTutorEvents({
      userId,
      projectId,
      message: OFF_TOPIC_QUESTION,
    });

    const refused = refusalEvents.some((event) => event.type === "insufficient_evidence");
    const streamed = refusalEvents.some((event) => event.type === "delta");

    checks.push(
      check(
        "tutor",
        "an unsupported question is refused, with no answer generated",
        refused && !streamed,
        refused ? "insufficient-evidence event, no answer streamed" : "no refusal event was emitted",
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------
  if (material && chunk && chunk.content.trim().length > 0) {
    const hits = await retrieveEvidence({ userId, projectId, query: chunk.content });

    checks.push(
      check(
        "retrieval",
        "the query's own passage ranks first",
        hits.length > 0 && hits[0]?.materialId === material.id,
        hits.length > 0
          ? `top score=${hits[0]!.score.toFixed(3)} from "${hits[0]!.title}" p.${hits[0]!.page}`
          : "no hits above the threshold",
      ),
    );

    const projectMaterials = new Set(
      (
        await prisma.material.findMany({ where: { projectId }, select: { id: true } })
      ).map((entry) => entry.id),
    );

    checks.push(
      check(
        "retrieval",
        "every hit belongs to this project",
        hits.every((hit) => projectMaterials.has(hit.materialId)),
        `${hits.length} hit(s), ${new Set(hits.map((hit) => hit.materialId)).size} material(s)`,
      ),
    );

    /*
     * Isolation, asserted at the storage level rather than by querying with a fabricated
     * project id: retrieval scopes on the *denormalized* `Chunk.projectId`, so if that
     * column ever drifted from its material's project, retrieval would leak across
     * projects. (A made-up id would also try to record telemetry against a project that
     * does not exist, which violates the foreign key.)
     */
    const chunkIds = hits.map((hit) => hit.id);
    const storedChunks =
      chunkIds.length > 0
        ? await prisma.chunk.findMany({
            where: { id: { in: chunkIds } },
            select: { id: true, projectId: true },
          })
        : [];

    const foreign = storedChunks.filter((row) => row.projectId !== projectId).length;

    checks.push(
      check(
        "retrieval",
        "every retrieved chunk is scoped to this project",
        storedChunks.length === chunkIds.length && foreign === 0,
        `${storedChunks.length} chunk(s) checked, ${foreign} scoped elsewhere`,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Assessment
  // -------------------------------------------------------------------------
  const quiz = await startQuiz(userId, { projectId, length: 2, mode: "QUIZ" });

  checks.push(
    check(
      "assessment",
      "a quiz is generated with questions",
      quiz.questions.length > 0,
      `${quiz.questions.length} question(s): ${quiz.questions.map((question) => question.type).join(", ")}`,
    ),
  );

  const stored = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id },
    select: { type: true, difficulty: true, correctAnswer: true, options: true, conceptId: true },
  });

  const multipleChoice = stored.find((question) => question.type === QuestionType.MULTIPLE_CHOICE);
  const optionIds = Array.isArray(multipleChoice?.options)
    ? (multipleChoice.options as unknown as Array<{ id: string }>).map((option) => option.id)
    : [];

  checks.push(
    check(
      "assessment",
      "a multiple-choice answer key matches one of its options",
      Boolean(multipleChoice?.correctAnswer) && optionIds.includes(multipleChoice!.correctAnswer!),
      `key=${multipleChoice?.correctAnswer ?? "none"} of [${optionIds.join(", ")}]`,
    ),
  );

  const concept =
    multipleChoice?.conceptId !== null && multipleChoice?.conceptId !== undefined
      ? await prisma.concept.findUnique({
          where: { id: multipleChoice.conceptId },
          select: { mastery: true },
        })
      : null;

  const expectedDifficulty = concept ? difficultyForMastery(concept.mastery) : null;

  checks.push(
    check(
      "assessment",
      "question difficulty follows the concept's mastery estimate",
      expectedDifficulty !== null && multipleChoice?.difficulty === expectedDifficulty,
      `difficulty=${multipleChoice?.difficulty ?? "-"} expected=${expectedDifficulty ?? "-"} (mastery ${concept?.mastery ?? "-"})`,
    ),
  );

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------
  const generated = await generateForProject(projectId);
  const open = (await listForProject(projectId)).filter((entry) => entry.status === "OPEN");

  checks.push(
    check(
      "recommendations",
      "at least one recommendation is produced",
      generated.created > 0 && open.length > 0,
      `${generated.created} generated, ${open.length} open`,
    ),
  );

  checks.push(
    check(
      "recommendations",
      "every recommendation states the evidence that prompted it",
      open.length > 0 && open.every((entry) => (entry.reason ?? "").trim().length > 0),
      `${open.filter((entry) => (entry.reason ?? "").trim().length > 0).length}/${open.length} have a reason`,
    ),
  );

  checks.push(
    check(
      "recommendations",
      "priorities stay within range",
      open.every((entry) => entry.priority >= 0 && entry.priority <= 1),
      open.map((entry) => entry.priority.toFixed(2)).join(", ") || "none",
    ),
  );

  const top = open[0];

  if (top) {
    const grade = await gradeArtefact(
      { userId, projectId },
      {
        criterion:
          "the recommendation is specific and actionable for this learner's weakest concepts, rather than generic advice that would fit anyone",
        task: `Recommend what the learner should do next in "${project.name}" (goal: ${project.goal}).`,
        artefact: `${top.title}\n\n${top.body}\n\nReason given: ${top.reason ?? "none"}`,
      },
    );

    checks.push(
      metric(
        "recommendations",
        "the top recommendation is actionable rather than generic (model-graded)",
        grade.score >= MODEL_GRADE_FLOOR,
        `score=${grade.score.toFixed(2)} — ${grade.verdict}`,
      ),
    );
  }

  return buildReport({ projectId, checks, startedAt, finishedAt: new Date() });
}
