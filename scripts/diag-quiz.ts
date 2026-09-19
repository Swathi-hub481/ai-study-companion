/**
 * Phase 7 acceptance harness.
 *
 * Runs the real adaptive quiz against the configured providers (Groq + local
 * embeddings), and reports what the flow actually did: which concepts were chosen and
 * at what difficulty, which answers reached a model, the feedback a learner would see,
 * and the resulting mastery.
 *
 * Usage: npx tsx scripts/diag-quiz.ts "<project name>" [length]
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

function oneLine(value: string, limit = 220): string {
  return value.replace(/\s+/g, " ").slice(0, limit);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { startQuiz, submitAnswer, completeQuiz, getQuiz } = await import("../lib/services/quizzes");
  const { drainQueue } = await import("../lib/jobs/worker");

  const projectName = process.argv[2];
  const length = Number(process.argv[3] ?? 3);

  const project = await prisma.project.findFirst({
    where: projectName ? { name: { contains: projectName } } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, space: { select: { userId: true } } },
  });

  if (!project) {
    console.log(`No project matching "${projectName}".`);
    return;
  }

  const userId = project.space.userId;
  console.log(`project: ${project.name} (${project.id})\n`);

  const conceptNames = new Map(
    (
      await prisma.concept.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, mastery: true, importance: true },
        orderBy: { name: "asc" },
      })
    ).map((concept) => [concept.id, concept]),
  );

  console.log(`concepts (${conceptNames.size}):`);
  for (const concept of conceptNames.values()) {
    console.log(
      `  - ${concept.name.padEnd(28)} mastery=${concept.mastery.toFixed(3)} importance=${concept.importance.toFixed(2)}`,
    );
  }

  console.log(`\nstarting a ${length}-question quiz…`);
  const quiz = await startQuiz(userId, { projectId: project.id, length, mode: "QUIZ" });

  const stored = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id },
    orderBy: { ord: "asc" },
    select: { id: true, type: true, difficulty: true, correctAnswer: true, conceptId: true, prompt: true },
  });

  console.log(`\nquiz ${quiz.id} — ${stored.length} questions`);
  for (const [index, question] of stored.entries()) {
    const concept = question.conceptId ? conceptNames.get(question.conceptId)?.name : "?";
    console.log(
      `  ${index + 1}. [${question.type}] difficulty=${question.difficulty.toFixed(2)} concept=${concept}`,
    );
    console.log(`     ${oneLine(question.prompt, 140)}`);
  }

  console.log("\nanswering…");
  for (const question of stored) {
    const callsBefore = await prisma.aiRequest.count({ where: { projectId: project.id } });

    const answer =
      question.type === "MULTIPLE_CHOICE"
        ? (question.correctAnswer ?? "a")
        : "It works by stepping against the gradient of the loss function, scaled by a learning rate.";

    const { result } = await submitAnswer(userId, quiz.id, { questionId: question.id, answer });
    const callsAfter = await prisma.aiRequest.count({ where: { projectId: project.id } });

    console.log(
      `  [${question.type}] score=${result.score} correct=${result.isCorrect} gradedBy=${result.gradedBy} modelCalls=${callsAfter - callsBefore}`,
    );
    if (result.feedback) console.log(`     feedback: ${oneLine(result.feedback)}`);
    if (result.conceptsCovered.length > 0) {
      console.log(`     covered: ${result.conceptsCovered.join(", ")}`);
    }
    if (result.conceptsMissing.length > 0) {
      console.log(`     missing: ${result.conceptsMissing.join(", ")}`);
    }
  }

  const completed = await completeQuiz(userId, quiz.id);
  console.log(`\nquiz status: ${completed.status}`);

  await drainQueue();

  const job = await prisma.job.findUnique({
    where: { idempotencyKey: `quiz:${quiz.id}:evaluate` },
  });
  console.log(`evaluation job: ${job?.status} result=${JSON.stringify(job?.result)}`);

  const view = await getQuiz(userId, quiz.id);
  const answered = view.questions.filter((question) => question.answer).length;
  console.log(`questions answered: ${answered}/${view.questions.length}`);

  const after = await prisma.concept.findMany({
    where: { projectId: project.id },
    select: { name: true, mastery: true },
    orderBy: { name: "asc" },
  });

  console.log("\nconcepts after:");
  for (const concept of after) {
    console.log(`  - ${concept.name.padEnd(28)} mastery=${concept.mastery.toFixed(3)}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
