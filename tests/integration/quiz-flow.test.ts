import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiFeature,
  QuestionType,
  QuizStatus,
  type Concept,
  type Material,
  type Project,
  type QuestionType as QuestionTypeEnum,
  type Space,
  type User,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { setEmbeddingProviderForTesting, type EmbeddingProvider } from "@/lib/ai";
import { getStorage } from "@/lib/storage";
import { createMaterial, processMaterial } from "@/lib/services/materials";
import {
  completeQuiz,
  getQuiz,
  listQuizzes,
  startQuiz,
  submitAnswer,
} from "@/lib/services/quizzes";
import { difficultyForMastery } from "@/lib/learning/selection";
import { drainQueue } from "@/lib/jobs/worker";
import { waitForDatabase } from "../helpers/db";

/**
 * Phase 7's acceptance criterion, on real infrastructure:
 * difficulty responds to mastery, and open-ended answers get explanatory feedback.
 *
 * The embedding provider is replaced with one that maps every text to the same unit
 * vector. The deterministic mock provider is non-semantic (any two different texts are
 * orthogonal), so without this, retrieval would find no evidence for a concept query and
 * every quiz would legitimately refuse to generate. Constant vectors make every stored
 * chunk a perfect match, which is what lets the flow be exercised offline.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

const DIMENSIONS = 384;
const unitVector = () => {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[0] = 1;
  return vector;
};

const constantEmbeddings: EmbeddingProvider = {
  name: "test-constant",
  async embed(request) {
    return {
      embeddings: request.input.map(() => unitVector()),
      usage: { promptTokens: 0, completionTokens: 0, estimated: true },
    };
  },
};

describe("quiz flow", () => {
  let user: User;
  let space: Space;
  let project: Project;
  let material: Material;
  let weak: Concept;
  let strong: Concept;

  let quizId: string;
  let questions: Array<{ id: string; type: QuestionTypeEnum; correctAnswer: string | null; difficulty: number; conceptId: string | null; ord: number }>;

  beforeAll(async () => {
    await waitForDatabase();
    setEmbeddingProviderForTesting(constantEmbeddings);

    user = await prisma.user.create({
      data: { email: `quiz-${runId}@example.com`, name: "Quiz Tester", passwordHash: PLACEHOLDER_HASH },
    });

    space = await prisma.space.create({
      data: { userId: user.id, name: `Quiz space ${runId}`, description: "Assessment tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Quiz project ${runId}`,
        description: "Assessment tests.",
        goal: "Prove the adaptive quiz works.",
      },
    });

    material = await createMaterial(user.id, project.id, {
      filename: "Gradient Descent Notes.pdf",
      declaredMimeType: "application/pdf",
      data: await readFile(path.join(fixtures, "text-document.pdf")),
    });

    const result = await processMaterial(material.id);
    expect(result.chunkCount).toBeGreaterThan(0);

    await prisma.job.deleteMany({ where: { idempotencyKey: `material:${material.id}:process` } });

    /*
     * The pipeline's own concepts are replaced with a controlled pair. Selection and
     * difficulty are what this file asserts, and those must be measured against known
     * mastery values rather than whatever the extractor happened to produce.
     */
    await prisma.concept.deleteMany({ where: { projectId: project.id } });

    weak = await prisma.concept.create({
      data: {
        projectId: project.id,
        name: "Gradient descent",
        description: "Stepping against the gradient of a loss function.",
        importance: 0.8,
        mastery: 0.1,
      },
    });

    strong = await prisma.concept.create({
      data: {
        projectId: project.id,
        name: "Backpropagation",
        description: "The chain rule applied through a computation graph.",
        importance: 0.8,
        mastery: 0.9,
      },
    });

    const quiz = await startQuiz(user.id, { projectId: project.id, length: 2, mode: "QUIZ" });
    quizId = quiz.id;

    questions = await prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: { ord: "asc" },
      select: { id: true, type: true, correctAnswer: true, difficulty: true, conceptId: true, ord: true },
    });
  });

  afterAll(async () => {
    setEmbeddingProviderForTesting(null);
    await getStorage().delete(material.storageKey).catch(() => {});
    await prisma.job.deleteMany({ where: { idempotencyKey: `quiz:${quizId}:evaluate` } });
    if (user?.id) await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("asks about the weakest concept first, at a difficulty set by its mastery", async () => {
    expect(questions).toHaveLength(2);

    expect(questions[0]?.conceptId).toBe(weak.id);
    expect(questions[0]?.difficulty).toBe(difficultyForMastery(0.1));

    expect(questions[1]?.conceptId).toBe(strong.id);
    expect(questions[1]?.difficulty).toBe(difficultyForMastery(0.9));

    // The criterion for this phase, stated directly.
    expect(questions[0]!.difficulty).toBeLessThan(questions[1]!.difficulty);
  });

  it("generates one multiple-choice and one open-ended question", async () => {
    expect(questions.map((question) => question.type).sort()).toEqual(
      [QuestionType.MULTIPLE_CHOICE, QuestionType.OPEN_ENDED].sort(),
    );
  });

  it("never sends the answer key to the client before the question is answered", async () => {
    const view = await getQuiz(user.id, quizId);

    for (const question of view.questions) {
      expect(question.answer).toBeNull();
      expect("correctAnswer" in question).toBe(false);
      expect(Object.keys(question)).not.toContain("correctAnswer");
    }
  });

  it("grades multiple choice by comparison, without calling a model", async () => {
    const question = questions.find((entry) => entry.type === QuestionType.MULTIPLE_CHOICE)!;
    const callsBefore = await prisma.aiRequest.count({ where: { projectId: project.id } });

    const { result } = await submitAnswer(user.id, quizId, {
      questionId: question.id,
      answer: question.correctAnswer!,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.score).toBe(1);
    expect(result.gradedBy).toBe("deterministic");
    expect(result.feedback).toBeTruthy();

    // Cost control: an MCQ must not reach the model at all.
    expect(await prisma.aiRequest.count({ where: { projectId: project.id } })).toBe(callsBefore);

    // The answer is evidence, and the mastery estimate follows from it.
    const evidence = await prisma.conceptEvidence.findMany({
      where: { conceptId: weak.id, source: "QUIZ_ANSWER" },
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.score).toBe(1);

    const concept = await prisma.concept.findUniqueOrThrow({ where: { id: weak.id } });
    expect(concept.mastery).toBeCloseTo(1, 4);
  });

  it("grades an open-ended answer with feedback that explains what is missing", async () => {
    const question = questions.find((entry) => entry.type === QuestionType.OPEN_ENDED)!;

    const { result } = await submitAnswer(user.id, quizId, {
      questionId: question.id,
      answer: "Gradient descent takes steps against the gradient of the loss function.",
    });

    expect(result.gradedBy).toBe("ai");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);

    // Explanatory, not a bare number.
    expect(result.feedback).toBeTruthy();
    expect(result.feedback!.length).toBeGreaterThan(30);
    expect(result.feedback).not.toMatch(/^\s*[\d.]+\s*$/);

    expect(result.conceptsCovered.length).toBeGreaterThan(0);
    expect(result.conceptsMissing.length).toBeGreaterThan(0);

    expect(
      await prisma.aiRequest.count({
        where: { projectId: project.id, feature: AiFeature.ANSWER_GRADE },
      }),
    ).toBeGreaterThan(0);

    const stored = await prisma.quizAnswer.findUniqueOrThrow({ where: { questionId: question.id } });
    expect(stored.gradedBy).toBe("ai");
    expect(stored.feedback).toBeTruthy();
    expect(stored.reasoning).toBeTruthy();
  });

  it("records the grading and the mastery change as activity", async () => {
    expect(
      await prisma.activityEvent.count({ where: { projectId: project.id, type: "ANSWER_GRADED" } }),
    ).toBe(2);

    expect(
      await prisma.activityEvent.count({ where: { projectId: project.id, type: "MASTERY_UPDATED" } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("refuses a second answer to the same question", async () => {
    const question = questions[0]!;

    await expect(
      submitAnswer(user.id, quizId, { questionId: question.id, answer: "b" }),
    ).rejects.toThrow();
  });

  it("completes the quiz, records it, and runs the evaluation job", async () => {
    const completed = await completeQuiz(user.id, quizId);

    expect(completed.status).toBe(QuizStatus.COMPLETED);
    expect(completed.completedAt).not.toBeNull();

    expect(
      await prisma.activityEvent.count({ where: { projectId: project.id, type: "QUIZ_COMPLETED" } }),
    ).toBe(1);

    const key = `quiz:${quizId}:evaluate`;
    const queued = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(queued.status).toBe("PENDING");

    await drainQueue();

    const evaluated = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(evaluated.status).toBe("COMPLETED");
    expect(evaluated.result).toBeTruthy();

    // Completing again is a no-op rather than an error or a duplicate event.
    await completeQuiz(user.id, quizId);
    expect(
      await prisma.activityEvent.count({ where: { projectId: project.id, type: "QUIZ_COMPLETED" } }),
    ).toBe(1);
  });

  it("answers reveal the correct option only once the question has been answered", async () => {
    const view = await getQuiz(user.id, quizId);

    for (const question of view.questions) {
      expect(question.answer).not.toBeNull();
    }
  });

  it("lists the project's quizzes with their results", async () => {
    const quizzes = await listQuizzes(user.id, project.id);

    expect(quizzes).toHaveLength(1);
    expect(quizzes[0]?.questionCount).toBe(2);
    expect(quizzes[0]?.answeredCount).toBe(2);
    expect(quizzes[0]?.averageScore).toBeGreaterThan(0);
  });

  it("refuses to let another user read, answer, or complete the quiz", async () => {
    const other = await prisma.user.create({
      data: { email: `quiz-other-${runId}@example.com`, name: "Other", passwordHash: PLACEHOLDER_HASH },
    });

    try {
      await expect(getQuiz(other.id, quizId)).rejects.toThrow();
      await expect(
        submitAnswer(other.id, quizId, { questionId: questions[0]!.id, answer: "a" }),
      ).rejects.toThrow();
      await expect(completeQuiz(other.id, quizId)).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("refuses to start a quiz for a project that is not yours", async () => {
    const other = await prisma.user.create({
      data: { email: `quiz-starter-${runId}@example.com`, name: "Starter", passwordHash: PLACEHOLDER_HASH },
    });

    try {
      await expect(
        startQuiz(other.id, { projectId: project.id, length: 1, mode: "QUIZ" }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });
});
