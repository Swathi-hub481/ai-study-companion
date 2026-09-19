import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobStatus, Role, type Material, type Project, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { setEmbeddingProviderForTesting, type EmbeddingProvider } from "@/lib/ai";
import { getStorage } from "@/lib/storage";
import { createMaterial, processMaterial } from "@/lib/services/materials";
import { getGlobalAnalytics, getProjectAnalytics } from "@/lib/services/analytics";
import {
  getAiUsage,
  getLatestEvaluation,
  getSystemHealth,
  getUserJourney,
  listActivity,
  listFilterOptions,
  listJobs,
  listUsers,
  retryJob,
} from "@/lib/services/admin";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { EVAL_SUITES, type EvalReport } from "@/lib/eval/report";
import { waitForDatabase } from "../helpers/db";

/**
 * Phase 9's acceptance criterion: an admin can trace one user from activity → assessment →
 * mastery → AI usage — and, first and foremost, a non-admin can do none of it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

/** Every query here is degenerate to a constant vector, so retrieval always returns hits. */
const constantEmbeddings: EmbeddingProvider = {
  name: "test-constant",
  async embed(request) {
    return {
      embeddings: request.input.map(() => {
        const vector = new Array<number>(384).fill(0);
        vector[0] = 1;
        return vector;
      }),
      usage: { promptTokens: 0, completionTokens: 0, estimated: true },
    };
  },
};

describe("admin and analytics", () => {
  let admin: User;
  let learner: User;
  let other: User;
  let space: Space;
  let project: Project;
  let material: Material;
  let deadJobId: string;
  let retryJobId: string;
  let staleJobId: string;
  let completedJobId: string;
  const jobKeys: string[] = [];

  beforeAll(async () => {
    await waitForDatabase();
    setEmbeddingProviderForTesting(constantEmbeddings);

    admin = await prisma.user.create({
      data: {
        email: `admin-${runId}@example.com`,
        name: "Admin Tester",
        passwordHash: PLACEHOLDER_HASH,
        role: Role.ADMIN,
      },
    });

    learner = await prisma.user.create({
      data: { email: `learner-${runId}@example.com`, name: "Journey Learner", passwordHash: PLACEHOLDER_HASH },
    });

    other = await prisma.user.create({
      data: { email: `other-${runId}@example.com`, name: "Someone Else", passwordHash: PLACEHOLDER_HASH },
    });

    space = await prisma.space.create({
      data: { userId: learner.id, name: `Admin space ${runId}`, description: "Admin tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Admin project ${runId}`,
        description: "Admin tests.",
        goal: "Prove the admin views.",
      },
    });

    // A processed document gives the eval suites a real fixture to run against.
    material = await createMaterial(learner.id, project.id, {
      filename: "Admin fixture.pdf",
      declaredMimeType: "application/pdf",
      data: await readFile(path.join(fixtures, "text-document.pdf")),
    });

    await processMaterial(material.id);
    await prisma.job.deleteMany({ where: { idempotencyKey: `material:${material.id}:process` } });

    const concept = await prisma.concept.findFirstOrThrow({ where: { projectId: project.id } });
    await prisma.conceptEvidence.create({
      data: {
        projectId: project.id,
        conceptId: concept.id,
        source: "QUIZ_ANSWER",
        score: 0.8,
        weight: 1,
      },
    });

    // Assessment history, so the journey has an assessment section to show.
    const quiz = await prisma.quiz.create({
      data: {
        projectId: project.id,
        mode: "QUIZ",
        status: "COMPLETED",
        title: "Seeded quiz",
        completedAt: new Date(),
      },
    });

    const question = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        type: "OPEN_ENDED",
        prompt: "Explain gradient descent in your own words.",
        ord: 0,
      },
    });

    await prisma.quizAnswer.create({
      data: {
        questionId: question.id,
        userAnswer: "It steps against the gradient.",
        isCorrect: true,
        score: 0.8,
        feedback: "Good, though it omits the learning rate.",
        gradedBy: "ai",
      },
    });

    await prisma.activityEvent.createMany({
      data: [
        { userId: learner.id, spaceId: space.id, projectId: project.id, type: "MATERIAL_UPLOADED" },
        { userId: learner.id, spaceId: space.id, projectId: project.id, type: "ANSWER_GRADED" },
        { userId: learner.id, spaceId: space.id, projectId: project.id, type: "TUTOR_MESSAGE" },
        { userId: other.id, type: "SPACE_CREATED", payload: { name: "Not this learner" } },
      ],
    });

    await prisma.aiRequest.createMany({
      data: [
        { userId: learner.id, projectId: project.id, feature: "TUTOR", provider: "mock", model: "mock-model", status: "SUCCESS" },
        { userId: learner.id, projectId: project.id, feature: "EMBED", provider: "mock", model: "mock-embed", status: "FAILED", error: "simulated failure" },
      ],
    });

    const deadKey = `admin-test:dead:${runId}`;
    const retryKey = `admin-test:retry:${runId}`;
    const staleKey = `admin-test:stale:${runId}`;
    const completedKey = `admin-test:completed:${runId}`;
    jobKeys.push(deadKey, retryKey, staleKey, completedKey);

    // One dead letter is left alone so the health view can assert on it; the retry test
    // gets its own, because retrying resurrects the row.
    const deadJob = await prisma.job.create({
      data: {
        type: "MATERIAL_PROCESS",
        status: JobStatus.DEAD,
        payload: { materialId: material.id },
        idempotencyKey: deadKey,
        attempts: 3,
        maxAttempts: 3,
        lastError: "simulated dead letter",
      },
    });
    deadJobId = deadJob.id;

    const retryJob = await prisma.job.create({
      data: {
        type: "MATERIAL_PROCESS",
        status: JobStatus.DEAD,
        payload: { materialId: material.id },
        idempotencyKey: retryKey,
        attempts: 3,
        maxAttempts: 3,
        lastError: "simulated dead letter",
      },
    });
    retryJobId = retryJob.id;

    const staleJob = await prisma.job.create({
      data: {
        type: "MATERIAL_PROCESS",
        status: JobStatus.RUNNING,
        payload: { materialId: material.id },
        idempotencyKey: staleKey,
        attempts: 1,
        lockedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    staleJobId = staleJob.id;

    const completedJob = await prisma.job.create({
      data: {
        type: "MATERIAL_PROCESS",
        status: JobStatus.COMPLETED,
        payload: { materialId: material.id },
        idempotencyKey: completedKey,
        completedAt: new Date(),
      },
    });
    completedJobId = completedJob.id;
  });

  afterAll(async () => {
    setEmbeddingProviderForTesting(null);
    await getStorage().delete(material.storageKey).catch(() => {});
    await prisma.job.deleteMany({ where: { idempotencyKey: { in: jobKeys } } });
    await prisma.job.deleteMany({ where: { type: "EVAL_RUN" } });
    for (const id of [admin?.id, learner?.id, other?.id]) {
      if (id) await prisma.user.deleteMany({ where: { id } });
    }
  });

  it("refuses every admin read to a normal user, and allows an admin", async () => {
    const normal = { role: Role.USER };
    const administrator = { role: Role.ADMIN };

    await expect(listUsers(normal)).rejects.toThrow();
    await expect(listFilterOptions(normal)).rejects.toThrow();
    await expect(getGlobalAnalytics(normal)).rejects.toThrow();
    await expect(getSystemHealth(normal)).rejects.toThrow();
    await expect(getAiUsage(normal)).rejects.toThrow();
    await expect(listJobs(normal)).rejects.toThrow();
    await expect(getLatestEvaluation(normal)).rejects.toThrow();
    await expect(getUserJourney(normal, learner.id)).rejects.toThrow();
    await expect(listActivity(normal)).rejects.toThrow();
    await expect(retryJob(normal, deadJobId)).rejects.toThrow();

    // And the same calls succeed for an administrator.
    await expect(getGlobalAnalytics(administrator)).resolves.toBeTruthy();
    await expect(getSystemHealth(administrator)).resolves.toBeTruthy();
    await expect(getAiUsage(administrator)).resolves.toBeTruthy();
    await expect(listJobs(administrator)).resolves.toBeTruthy();
  });

  it("keeps project analytics owner-scoped", async () => {
    const analytics = await getProjectAnalytics(learner.id, project.id);

    expect(analytics.materials.ready).toBeGreaterThan(0);
    expect(analytics.mastery.concepts.length).toBeGreaterThan(0);
    expect(analytics.activityTotal).toBeGreaterThan(0);

    await expect(getProjectAnalytics(other.id, project.id)).rejects.toThrow();
  });

  it("narrows the activity feed by user and by type", async () => {
    const byUser = await listActivity({ role: Role.ADMIN }, { userId: learner.id, pageSize: 100 });
    expect(byUser.total).toBeGreaterThanOrEqual(3);
    expect(byUser.items.every((item) => item.userId === learner.id)).toBe(true);

    const byType = await listActivity({ role: Role.ADMIN }, { type: "TUTOR_MESSAGE", pageSize: 100 });
    expect(byType.total).toBeGreaterThanOrEqual(1);
    expect(byType.items.every((item) => item.type === "TUTOR_MESSAGE")).toBe(true);
    // The other learner's SPACE_CREATED must not survive a type filter.
    expect(byType.items.some((item) => item.userId === other.id)).toBe(false);

    const byRange = await listActivity({ role: Role.ADMIN }, { since: new Date(Date.now() - 3_600_000), pageSize: 100 });
    expect(byRange.total).toBeGreaterThanOrEqual(1);

    const byUnknownType = await listActivity({ role: Role.ADMIN }, { type: "NOT_A_REAL_TYPE" });
    expect(byUnknownType.total).toBe(0);
  });

  it("traces one user from activity through assessment and mastery to AI usage", async () => {
    const journey = await getUserJourney({ role: Role.ADMIN }, learner.id);

    expect(journey.user.id).toBe(learner.id);
    // Upload + ready + the three seeded events.
    expect(journey.activity.total).toBeGreaterThanOrEqual(5);
    // The other user's SPACE_CREATED must not leak in — that is the isolation property,
    // asserted by type rather than by a brittle total.
    expect(journey.activity.byType.some((entry) => entry.type === "SPACE_CREATED")).toBe(false);
    expect(journey.activity.byType.some((entry) => entry.type === "ANSWER_GRADED")).toBe(true);
    expect(journey.assessments.answersGraded).toBe(1);
    expect(journey.assessments.averageScore).toBeCloseTo(0.8, 4);
    expect(journey.mastery.concepts.length).toBeGreaterThan(0);
    expect(journey.ai.calls).toBeGreaterThanOrEqual(2);
    expect(journey.ai.failures).toBeGreaterThanOrEqual(1);
    expect(journey.ai.byFeature.some((entry) => entry.feature === "TUTOR")).toBe(true);

    // Every project in the journey belongs to this learner's space.
    expect(journey.projects.every((entry) => entry.spaceId === space.id)).toBe(true);

    await expect(getUserJourney({ role: Role.ADMIN }, "no-such-user")).rejects.toThrow();
  });

  it("surfaces dead letters with their error, and retries them", async () => {
    const dead = await listJobs({ role: Role.ADMIN }, { status: JobStatus.DEAD });

    const mine = dead.find((job) => job.id === deadJobId);
    expect(mine).toBeTruthy();
    expect(mine?.lastError).toBe("simulated dead letter");
    expect(mine?.attempts).toBe(3);

    await retryJob({ role: Role.ADMIN }, retryJobId);

    const retried = await prisma.job.findUniqueOrThrow({ where: { id: retryJobId } });
    expect(retried.status).toBe(JobStatus.PENDING);
    expect(retried.attempts).toBe(0);
    expect(retried.lastError).toBeNull();

    // The untouched dead letter is still dead — retrying one job must not sweep the queue.
    const untouched = await prisma.job.findUniqueOrThrow({ where: { id: deadJobId } });
    expect(untouched.status).toBe(JobStatus.DEAD);
  });

  it("refuses to retry a job that has not failed", async () => {
    await expect(retryJob({ role: Role.ADMIN }, completedJobId)).rejects.toThrow();
    await expect(retryJob({ role: Role.ADMIN }, "no-such-job")).rejects.toThrow();
  });

  it("reports queue health, including a job stuck running", async () => {
    // Precondition first, so a failure here says the fixture is wrong rather than the report.
    const stale = await prisma.job.findUniqueOrThrow({ where: { id: staleJobId } });
    expect(stale.status).toBe(JobStatus.RUNNING);
    expect(stale.lockedAt).not.toBeNull();

    const health = await getSystemHealth({ role: Role.ADMIN });

    expect(health.database).toBe(true);
    expect(health.jobs.DEAD).toBeGreaterThanOrEqual(1);
    expect(health.jobs.COMPLETED).toBeGreaterThanOrEqual(1);
    expect(health.staleRunning).toBeGreaterThanOrEqual(1);
    expect(health.config.aiProvider).toBe("mock");
    expect(Object.keys(health.jobs).sort()).toEqual([
      "COMPLETED",
      "DEAD",
      "FAILED",
      "PENDING",
      "RUNNING",
    ]);
  });

  it("aggregates AI usage by feature and reports failures", async () => {
    const usage = await getAiUsage({ role: Role.ADMIN }, { days: 30 });

    expect(usage.totals.calls).toBeGreaterThanOrEqual(2);
    expect(usage.totals.failures).toBeGreaterThanOrEqual(1);
    expect(usage.byFeature.some((entry) => entry.feature === "TUTOR")).toBe(true);
    expect(usage.recentFailures.some((entry) => entry.error === "simulated failure")).toBe(true);
    expect(usage.series.length).toBe(30);
  });

  it("runs the evaluation suites through the job and stores the report", async () => {
    const key = `eval:${project.id}:${runId}`;
    jobKeys.push(key);

    await enqueueJob({
      type: "EVAL_RUN",
      payload: { projectId: project.id },
      idempotencyKey: key,
      maxAttempts: 1,
    });

    await drainQueue();

    const job = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(job.status).toBe(JobStatus.COMPLETED);

    const latest = await getLatestEvaluation({ role: Role.ADMIN });
    expect(latest).not.toBeNull();

    const report = latest!.report as EvalReport;
    expect(report.projectId).toBe(project.id);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(Object.keys(report.suites).sort()).toEqual([...EVAL_SUITES].sort());

    // Every check must carry evidence, so a failure explains itself.
    expect(report.checks.every((entry) => entry.detail.length > 0)).toBe(true);

    /*
     * The new `EVAL` enum value has to survive the round trip to Postgres — the generated
     * client was refreshed but the query engine binary was not, so this asserts the engine
     * accepts the value rather than silently dropping the row.
     */
    const evalCalls = await prisma.aiRequest.count({ where: { feature: "EVAL" } });
    expect(evalCalls).toBeGreaterThan(0);
  });
});
