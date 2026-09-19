/**
 * AI evaluation suites (§10.5).
 *
 * Provisions a curated fixture project, runs the four suites through the `eval.run` job,
 * and prints the report. The report is stored as that job's result, which is what the
 * admin AI view reads — so a run is visible in the product, not only in a terminal.
 *
 * Usage: npm run eval
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
// Type-only, so it is erased at compile time and does not defeat the deferred env loading
// that the dynamic imports below rely on.
import type { EvalReport } from "../lib/eval/report";

config({ path: ".env", quiet: true });

const FIXTURE_EMAIL = "eval-fixture@example.com";
const FIXTURE_PASSWORD = "eval-fixture-password";
const FIXTURE_SPACE = "Evaluation fixture";
const FIXTURE_PROJECT = "Evaluation project";

/**
 * Idempotent fixture: the same inputs every run, so a change in the numbers is a change
 * in the system rather than in the data.
 */
async function ensureFixture(): Promise<string> {
  const { prisma } = await import("../lib/db");
  const { hashPassword } = await import("../lib/auth/password");
  const { createMaterial, processMaterial } = await import("../lib/services/materials");
  const { MaterialStatus } = await import("@prisma/client");

  let user = await prisma.user.findUnique({ where: { email: FIXTURE_EMAIL } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: FIXTURE_EMAIL,
        name: "Evaluation Fixture",
        passwordHash: await hashPassword(FIXTURE_PASSWORD),
      },
    });
  }

  let space = await prisma.space.findFirst({ where: { userId: user.id, name: FIXTURE_SPACE } });

  if (!space) {
    space = await prisma.space.create({
      data: {
        userId: user.id,
        name: FIXTURE_SPACE,
        description: "Fixed inputs for the evaluation suites.",
      },
    });
  }

  let project = await prisma.project.findFirst({
    where: { spaceId: space.id, name: FIXTURE_PROJECT },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: FIXTURE_PROJECT,
        description: "Curated fixture for the retrieval, tutor, assessment and recommendation suites.",
        goal: "Explain gradient descent and backpropagation, and how the loss is minimised.",
      },
    });
  }

  const ready = await prisma.material.count({
    where: { projectId: project.id, status: MaterialStatus.READY },
  });

  if (ready === 0) {
    const fixturesDir = fileURLToPath(new URL("../tests/fixtures", import.meta.url));

    const material = await createMaterial(user.id, project.id, {
      filename: "Evaluation fixture.pdf",
      declaredMimeType: "application/pdf",
      data: await readFile(`${fixturesDir}/text-document.pdf`),
    });

    console.log(`processing fixture material ${material.id} …`);
    await processMaterial(material.id);

    // The fixture is processed inline, so its queued job is redundant.
    await prisma.job.deleteMany({ where: { idempotencyKey: `material:${material.id}:process` } });
  }

  return project.id;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * Gives the fixture learner a profile: confident on one concept, failing another.
 *
 * Without it every concept sits at zero mastery and no assessment history exists, so any
 * recommendation is generically correct — which would make the "is it actionable?" check
 * measure the fixture's emptiness rather than the recommender.
 */
async function seedLearnerProfile(projectId: string): Promise<void> {
  const { prisma } = await import("../lib/db");

  const existing = await prisma.conceptEvidence.count({ where: { projectId } });
  if (existing > 0) return;

  const concepts = await prisma.concept.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    take: 2,
    select: { id: true },
  });

  if (concepts.length < 2) return;

  const [strong, weak] = concepts as [{ id: string }, { id: string }];

  await prisma.conceptEvidence.createMany({
    data: [
      { projectId, conceptId: strong.id, source: "QUIZ_ANSWER", score: 1, weight: 1, createdAt: daysAgo(20) },
      { projectId, conceptId: strong.id, source: "QUIZ_ANSWER", score: 1, weight: 1, createdAt: daysAgo(2) },
      { projectId, conceptId: weak.id, source: "QUIZ_ANSWER", score: 0, weight: 1, createdAt: daysAgo(20) },
      { projectId, conceptId: weak.id, source: "QUIZ_ANSWER", score: 0, weight: 1, createdAt: daysAgo(2) },
    ],
  });

  const { refreshProjectMastery } = await import("../lib/services/mastery");
  await refreshProjectMastery(projectId);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { enqueueJob } = await import("../lib/jobs/queue");
  const { drainQueue } = await import("../lib/jobs/worker");
  const { formatReport } = await import("../lib/eval/report");
  const { JobType, JobStatus } = await import("@prisma/client");

  const projectId = await ensureFixture();
  await seedLearnerProfile(projectId);
  console.log(`fixture project ${projectId}\n`);

  const idempotencyKey = `eval:${projectId}:${Date.now()}`;

  await enqueueJob({
    type: JobType.EVAL_RUN,
    payload: { projectId },
    idempotencyKey,
    // Evaluation makes many model calls; one attempt is enough for a manual run.
    maxAttempts: 1,
  });

  console.log("running the suites (this makes real model calls)…");
  await drainQueue();

  const job = await prisma.job.findUnique({
    where: { idempotencyKey },
    select: { status: true, result: true, lastError: true },
  });

  if (!job || job.status !== JobStatus.COMPLETED || !job.result) {
    console.error(`\nevaluation job did not complete (status=${job?.status ?? "missing"})`);
    if (job?.lastError) console.error(job.lastError);
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const report = job.result as unknown as EvalReport;

  console.log(formatReport(report));

  await prisma.$disconnect();
  process.exitCode = report.ok ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
