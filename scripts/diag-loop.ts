/**
 * The whole learning loop, in one run.
 *
 * Walks Space → Project → Material → grounded Tutor answer → Quiz → Assessment → Mastery →
 * Growth → Recommendation → Analytics against the real stack, printing what each stage
 * observed. This is the phase's "demonstrable end-to-end" criterion in a form that runs
 * without a browser: it drives the same services the routes call, so a failure here is a
 * failure of the product rather than of the harness.
 *
 * Usage: npm run diag:loop
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
// Type-only, so it is erased and does not defeat the deferred env loading below.
import type { TutorEvent } from "../lib/services/tutor";

config({ path: ".env", quiet: true });

const RUN_EMAIL = "loop-fixture@example.com";
const RUN_PASSWORD = "loop-fixture-password";
const RUN_SPACE = "Loop fixture";
const RUN_PROJECT = "Loop fixture project";

const OFF_TOPIC = "Explain the mating rituals of Antarctic krill using quantum field theory.";

type Stage = { stage: string; ok: boolean; detail: string };

function oneLine(value: string, limit = 140): string {
  return value.replace(/\s+/g, " ").slice(0, limit);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { hashPassword } = await import("../lib/auth/password");
  const { createMaterial } = await import("../lib/services/materials");
  const { askTutor } = await import("../lib/services/tutor");
  const { startQuiz, submitAnswer, completeQuiz } = await import("../lib/services/quizzes");
  const { getProjectGrowth } = await import("../lib/services/growth");
  const { generateForProject, listForProject } = await import("../lib/services/recommendations");
  const { getProjectAnalytics } = await import("../lib/services/analytics");
  const { drainQueue } = await import("../lib/jobs/worker");
  const { MaterialStatus, QuestionType } = await import("@prisma/client");

  const stages: Stage[] = [];

  function record(stage: string, ok: boolean, detail: string): void {
    stages.push({ stage, ok, detail });
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${stage}${detail ? ` — ${detail}` : ""}`);
  }

  // -------------------------------------------------------------------------
  // 1. Identity, Space, Project
  // -------------------------------------------------------------------------
  let user = await prisma.user.findUnique({ where: { email: RUN_EMAIL } });

  if (!user) {
    user = await prisma.user.create({
      data: { email: RUN_EMAIL, name: "Loop Fixture", passwordHash: await hashPassword(RUN_PASSWORD) },
    });
  }

  let space = await prisma.space.findFirst({ where: { userId: user.id, name: RUN_SPACE } });
  space ??= await prisma.space.create({
    data: { userId: user.id, name: RUN_SPACE, description: "Walks the whole learning loop." },
  });

  let project = await prisma.project.findFirst({ where: { spaceId: space.id, name: RUN_PROJECT } });
  project ??= await prisma.project.create({
    data: {
      spaceId: space.id,
      name: RUN_PROJECT,
      description: "End-to-end fixture.",
      goal: "Explain gradient descent and backpropagation and how the loss is minimised.",
    },
  });

  record("space + project", Boolean(space.id && project.id), `${space.name} / ${project.name}`);

  // -------------------------------------------------------------------------
  // 2. Material → knowledge (upload, then the worker)
  // -------------------------------------------------------------------------
  let material = await prisma.material.findFirst({
    where: { projectId: project.id, status: MaterialStatus.READY },
  });

  if (!material) {
    const fixturesDir = fileURLToPath(new URL("../tests/fixtures", import.meta.url));

    material = await createMaterial(user.id, project.id, {
      filename: "Loop fixture.pdf",
      declaredMimeType: "application/pdf",
      data: await readFile(`${fixturesDir}/text-document.pdf`),
    });

    console.log("  …   processing material through the worker");
    await drainQueue();
    material = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });
  }

  const chunkCount = await prisma.chunk.count({ where: { materialId: material.id } });
  const conceptCount = await prisma.concept.count({ where: { projectId: project.id } });

  record(
    "material → searchable knowledge",
    material.status === MaterialStatus.READY && chunkCount > 0 && conceptCount > 0,
    `status=${material.status} chunks=${chunkCount} concepts=${conceptCount}`,
  );

  const chunk = await prisma.chunk.findFirstOrThrow({
    where: { materialId: material.id },
    orderBy: { ord: "asc" },
    select: { content: true },
  });

  // -------------------------------------------------------------------------
  // 3. Tutor: a grounded answer, and a refusal
  // -------------------------------------------------------------------------
  const question = `Explain what this passage means: ${chunk.content.slice(0, 300)}`;
  const answerEvents: TutorEvent[] = [];
  for await (const event of askTutor(user.id, { projectId: project.id, message: question })) {
    answerEvents.push(event);
  }

  const citationsEvent = answerEvents.find((event) => event.type === "citations");
  const citations = citationsEvent?.type === "citations" ? citationsEvent.citations : [];
  const answer = answerEvents
    .filter((event) => event.type === "delta")
    .map((event) => (event.type === "delta" ? event.text : ""))
    .join("");

  record(
    "tutor answers with citations",
    citations.length > 0 && answer.length > 0,
    `${citations.length} citation(s), ${answer.length} characters: "${oneLine(answer, 80)}"`,
  );

  const refusalEvents: TutorEvent[] = [];
  for await (const event of askTutor(user.id, { projectId: project.id, message: OFF_TOPIC })) {
    refusalEvents.push(event);
  }

  record(
    "tutor refuses an unsupported question",
    refusalEvents.some((event) => event.type === "insufficient_evidence") &&
      !refusalEvents.some((event) => event.type === "delta"),
    "refused with no answer generated",
  );

  // -------------------------------------------------------------------------
  // 4. Quiz: generate, answer, complete
  // -------------------------------------------------------------------------
  const quiz = await startQuiz(user.id, { projectId: project.id, length: 2, mode: "QUIZ" });

  record(
    "quiz generated",
    quiz.questions.length > 0,
    quiz.questions.map((entry) => entry.type).join(", "),
  );

  const questions = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id },
    orderBy: { ord: "asc" },
    select: { id: true, type: true, correctAnswer: true },
  });

  let graded = 0;
  let withFeedback = 0;

  for (const entry of questions) {
    const input =
      entry.type === QuestionType.MULTIPLE_CHOICE
        ? (entry.correctAnswer ?? "a")
        : "It steps against the gradient of the loss, scaled by a learning rate.";

    const { result } = await submitAnswer(user.id, quiz.id, {
      questionId: entry.id,
      answer: input,
    });

    graded += 1;
    if (result.feedback && result.feedback.length > 0) withFeedback += 1;
  }

  record(
    "answers graded",
    graded === questions.length && withFeedback === graded,
    `${graded} graded, ${withFeedback} with explanatory feedback`,
  );

  const completed = await completeQuiz(user.id, quiz.id);
  await drainQueue();

  const evaluation = await prisma.job.findUnique({
    where: { idempotencyKey: `quiz:${quiz.id}:evaluate` },
    select: { status: true },
  });

  record(
    "quiz completed and evaluated",
    completed.status === "COMPLETED" && evaluation?.status === "COMPLETED",
    `quiz=${completed.status} evaluation-job=${evaluation?.status ?? "missing"}`,
  );

  // -------------------------------------------------------------------------
  // 5. Mastery and growth
  // -------------------------------------------------------------------------
  const growth = await getProjectGrowth(user.id, project.id);
  const bands = growth.reduce<Record<string, number>>((totals, concept) => {
    totals[concept.band] = (totals[concept.band] ?? 0) + 1;
    return totals;
  }, {});

  record(
    "mastery and growth computed",
    growth.length > 0 && growth.some((concept) => concept.evidenceCount > 0),
    `${growth.length} concepts, bands ${JSON.stringify(bands)}`,
  );

  // -------------------------------------------------------------------------
  // 6. Recommendations
  // -------------------------------------------------------------------------
  const generated = await generateForProject(project.id);
  const open = (await listForProject(project.id)).filter((entry) => entry.status === "OPEN");

  record(
    "recommendations generated",
    generated.created > 0 && open.length > 0 && open.every((entry) => Boolean(entry.reason)),
    `${open.length} open, top: "${oneLine(open[0]?.title ?? "", 60)}"`,
  );

  // -------------------------------------------------------------------------
  // 7. Analytics
  // -------------------------------------------------------------------------
  const analytics = await getProjectAnalytics(user.id, project.id);

  record(
    "analytics",
    analytics.activityTotal > 0 && analytics.ai.calls > 0,
    `activity=${analytics.activityTotal} aiCalls=${analytics.ai.calls} mastery=${analytics.mastery.average.toFixed(2)}`,
  );

  // -------------------------------------------------------------------------
  const failed = stages.filter((stage) => !stage.ok);

  console.log(
    `\n${failed.length === 0 ? "PASSED" : "FAILED"}: ${stages.length - failed.length}/${stages.length} stages`,
  );

  await prisma.$disconnect();
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
