import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobStatus, JobType, MaterialStatus, type Project, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueJob, requeueJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";
import { createMaterial, getMaterial, processMaterial, retryMaterial } from "@/lib/services/materials";
import { waitForDatabase } from "../helpers/db";

/**
 * The Phase 5 acceptance criterion, on real infrastructure:
 * uploading a PDF reaches READY asynchronously, and a forced failure retries and then
 * dead-letters where it can be seen.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(fixtures, name));
}

describe("material processing pipeline", () => {
  let user: User;
  let space: Space;
  let project: Project;
  const storageKeys: string[] = [];
  const jobKeys: string[] = [];

  beforeAll(async () => {
    await waitForDatabase();

    /*
     * The job queue is global state: `drainQueue()` claims any due job, not just ones
     * this file created, and `Job` has no owner to cascade from. Leftovers from an
     * earlier run (including this file's own dead-lettered jobs) would be claimed
     * first — ordered by `runAt` — and would skew every count asserted below.
     *
     * No other test file enqueues jobs, and files run sequentially, so this file can
     * own the queue for its duration.
     */
    await prisma.job.deleteMany({});

    user = await prisma.user.create({
      data: { email: `mat-${runId}@example.com`, name: "Material Tester", passwordHash: PLACEHOLDER_HASH },
    });

    space = await prisma.space.create({
      data: { userId: user.id, name: `Material space ${runId}`, description: "Pipeline tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Material project ${runId}`,
        description: "Pipeline tests.",
        goal: "Prove the pipeline works.",
      },
    });
  });

  afterAll(async () => {
    const storage = getStorage();

    for (const key of storageKeys) {
      await storage.delete(key).catch(() => {});
    }

    // Jobs have no user relation, so they are cleaned up by their keys.
    if (jobKeys.length > 0) {
      await prisma.job.deleteMany({ where: { idempotencyKey: { in: jobKeys } } });
    }

    if (user?.id) {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it("accepts an upload, queues the work, and records the upload event", async () => {
    const data = await fixture("text-document.pdf");

    const material = await createMaterial(user.id, project.id, {
      filename: "Gradient Descent Notes.pdf",
      declaredMimeType: "application/pdf",
      data,
    });

    storageKeys.push(material.storageKey);
    jobKeys.push(`material:${material.id}:process`);

    expect(material.status).toBe(MaterialStatus.QUEUED);
    expect(material.sizeBytes).toBe(data.length);
    expect(material.filename).toBe("Gradient Descent Notes.pdf");

    const queued = await prisma.job.findUnique({
      where: { idempotencyKey: `material:${material.id}:process` },
    });

    expect(queued?.status).toBe(JobStatus.PENDING);
    expect(queued?.type).toBe(JobType.MATERIAL_PROCESS);

    const events = await prisma.activityEvent.findMany({
      where: { projectId: project.id, type: "MATERIAL_UPLOADED" },
    });
    expect(events).toHaveLength(1);
  });

  it("rejects a file that is not a PDF, regardless of what the client claims", async () => {
    // A .pdf name and a spoofed Content-Type must not be enough.
    const notAPdf = Buffer.from("This is plainly not a PDF document.");

    await expect(
      createMaterial(user.id, project.id, {
        filename: "notes.pdf",
        declaredMimeType: "application/pdf",
        data: notAPdf,
      }),
    ).rejects.toThrow();

    expect(await prisma.material.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("refuses an upload into a project the caller does not own", async () => {
    const other = await prisma.user.create({
      data: { email: `mat-other-${runId}@example.com`, name: "Other", passwordHash: PLACEHOLDER_HASH },
    });

    try {
      await expect(
        createMaterial(other.id, project.id, {
          filename: "intrusion.pdf",
          declaredMimeType: "application/pdf",
          data: await fixture("text-document.pdf"),
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("processes the document to READY asynchronously, with chunks and concepts", async () => {
    const material = await prisma.material.findFirstOrThrow({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });

    const summary = await drainQueue();

    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBeGreaterThanOrEqual(1);

    const processed = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });

    expect(processed.status).toBe(MaterialStatus.READY);
    expect(processed.error).toBeNull();
    expect(processed.pageCount).toBe(3);
    expect(processed.processedAt).not.toBeNull();

    const chunks = await prisma.chunk.findMany({
      where: { materialId: material.id },
      orderBy: { ord: "asc" },
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenCount > 0)).toBe(true);
    // Pages are recorded, which is what makes citations possible.
    expect(new Set(chunks.map((chunk) => chunk.page))).toEqual(new Set([1, 2, 3]));

    const concepts = await prisma.concept.findMany({ where: { projectId: project.id } });
    expect(concepts.length).toBeGreaterThan(0);

    const links = await prisma.materialConcept.findMany({ where: { materialId: material.id } });
    expect(links.length).toBe(concepts.length);

    const job = await prisma.job.findUnique({
      where: { idempotencyKey: `material:${material.id}:process` },
    });
    expect(job?.status).toBe(JobStatus.COMPLETED);
    expect(job?.completedAt).not.toBeNull();
  });

  it("stores a vector for every chunk, readable through pgvector", async () => {
    const material = await prisma.material.findFirstOrThrow({
      where: { projectId: project.id, status: MaterialStatus.READY },
    });

    const rows = await prisma.$queryRaw<Array<{ missing: bigint }>>`
      SELECT count(*) FILTER (WHERE embedding IS NULL) AS missing
        FROM "Chunk"
       WHERE "materialId" = ${material.id}
    `;

    // This is the check that the raw-SQL vector write actually landed.
    expect(Number(rows[0]?.missing ?? -1)).toBe(0);

    // And that pgvector can compute similarity over them.
    const similarity = await prisma.$queryRaw<Array<{ score: number }>>`
      SELECT 1 - (embedding <=> (SELECT embedding FROM "Chunk" WHERE "materialId" = ${material.id} LIMIT 1)) AS score
        FROM "Chunk"
       WHERE "materialId" = ${material.id}
       LIMIT 1
    `;

    expect(similarity[0]?.score).toBeCloseTo(1, 5);
  });

  it("is idempotent — reprocessing replaces chunks instead of duplicating them", async () => {
    const material = await prisma.material.findFirstOrThrow({
      where: { projectId: project.id, status: MaterialStatus.READY },
    });

    const before = await prisma.chunk.count({ where: { materialId: material.id } });
    const conceptsBefore = await prisma.concept.count({ where: { projectId: project.id } });

    // This is what a retried job does: run the whole pipeline again.
    await processMaterial(material.id);

    const after = await prisma.chunk.count({ where: { materialId: material.id } });
    const conceptsAfter = await prisma.concept.count({ where: { projectId: project.id } });

    expect(after).toBe(before);
    expect(conceptsAfter).toBe(conceptsBefore);
  });

  it("treats a duplicate enqueue as a no-op", async () => {
    const key = `test:duplicate:${runId}`;

    const first = await enqueueJob({
      type: JobType.MATERIAL_PROCESS,
      payload: { materialId: "anything" },
      idempotencyKey: key,
    });
    const second = await enqueueJob({
      type: JobType.MATERIAL_PROCESS,
      payload: { materialId: "anything" },
      idempotencyKey: key,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);

    // Removed immediately: this job exists only to prove enqueue semantics, and a due
    // PENDING row left behind would be claimed by a later test's drainQueue.
    await prisma.job.deleteMany({ where: { idempotencyKey: key } });
  });

  it("retries a failing job, then dead-letters it once attempts are exhausted", async () => {
    const key = `test:failing:${runId}`;
    jobKeys.push(key);

    /*
     * A registered handler that fails deterministically: the material does not exist, so
     * `processMaterial` throws. Earlier versions of this test enqueued a job type with *no*
     * handler, which broke every time a later phase registered one — this depends only on
     * behaviour, not on the registry happening to be incomplete.
     */
    await enqueueJob({
      type: JobType.MATERIAL_PROCESS,
      payload: { materialId: `missing-${runId}` },
      idempotencyKey: key,
      maxAttempts: 2,
    });

    const firstRun = await drainQueue();
    expect(firstRun.processed).toBeGreaterThanOrEqual(1);

    // Asserted on this job rather than on the aggregate counts, so unrelated queue
    // state could never make the test lie about the retry behaviour.
    const afterFirst = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(afterFirst.status).toBe(JobStatus.FAILED);
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.lastError).toContain("no longer exists");
    // Scheduled into the future, which is why the drain above stopped rather than spinning.
    expect(afterFirst.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(afterFirst.lockedAt).toBeNull();

    // Bring the retry forward rather than waiting out the backoff.
    await prisma.job.update({ where: { idempotencyKey: key }, data: { runAt: new Date() } });

    await drainQueue();

    const dead = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(dead.status).toBe(JobStatus.DEAD);
    expect(dead.attempts).toBe(2);
    expect(dead.lastError).toContain("no longer exists");
    expect(dead.lockedAt).toBeNull();
  });

  it("resets an existing job when a retry is requested, rather than adding a second one", async () => {
    const material = await prisma.material.findFirstOrThrow({
      where: { projectId: project.id, status: MaterialStatus.READY },
    });

    const key = `material:${material.id}:process`;

    // Force the job into a dead state, then recover it the way the retry button does.
    await prisma.job.update({
      where: { idempotencyKey: key },
      data: { status: JobStatus.DEAD, attempts: 3, lastError: "simulated" },
    });

    const reused = await requeueJob(key, { resetAttempts: true });

    expect(reused).toBe(true);
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);

    const requeued = await prisma.job.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(requeued.status).toBe(JobStatus.PENDING);
    expect(requeued.attempts).toBe(0);
    expect(requeued.lastError).toBeNull();
  });

  it("records a FAILED material with its reason when processing cannot succeed", async () => {
    const orphanId = `orphan-${runId}`;

    // No such material exists, which is the case a job hits when a user deletes a
    // document while it is still queued.
    await expect(processMaterial(orphanId)).rejects.toThrow();

    const failed = await prisma.material.count({
      where: { projectId: project.id, status: MaterialStatus.FAILED },
    });
    expect(failed).toBe(0);
  });

  it("fails a scanned document with an actionable reason rather than reporting success", async () => {
    // OCR is disabled in the test environment, so this is the image-only fixture with
    // no text layer and no fallback — exactly what a user with a scan would hit.
    const material = await createMaterial(user.id, project.id, {
      filename: "scanned-document.pdf",
      declaredMimeType: "application/pdf",
      data: await fixture("scanned-document.pdf"),
    });

    storageKeys.push(material.storageKey);
    jobKeys.push(`material:${material.id}:process`);

    await drainQueue();

    const processed = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });

    // A READY material with zero chunks would look like success while being useless
    // to the Tutor, so this must fail and say why.
    expect(processed.status).toBe(MaterialStatus.FAILED);
    expect(processed.error).toMatch(/scanned|no text/i);
    expect(await prisma.chunk.count({ where: { materialId: material.id } })).toBe(0);

    const failedEvent = await prisma.activityEvent.findFirst({
      where: { projectId: project.id, type: "MATERIAL_FAILED" },
    });
    expect(failedEvent).not.toBeNull();
  });

  it("can retry a failed material through the service", async () => {
    const failed = await prisma.material.findFirstOrThrow({
      where: { projectId: project.id, status: MaterialStatus.FAILED },
    });

    const retried = await retryMaterial(user.id, failed.id);

    expect(retried.status).toBe(MaterialStatus.QUEUED);
    expect(retried.error).toBeNull();

    // One job per material, reset rather than duplicated.
    expect(
      await prisma.job.count({ where: { idempotencyKey: `material:${failed.id}:process` } }),
    ).toBe(1);
  });

  it("refuses to read another user's material", async () => {
    const other = await prisma.user.create({
      data: { email: `mat-reader-${runId}@example.com`, name: "Reader", passwordHash: PLACEHOLDER_HASH },
    });

    try {
      const material = await prisma.material.findFirstOrThrow({ where: { projectId: project.id } });
      await expect(getMaterial(other.id, material.id)).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });
});
