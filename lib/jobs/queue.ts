import { JobStatus, JobType, Prisma, type Job } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Durable background job queue.
 *
 * Backed by the `Job` table rather than Redis, so job state is transactionally
 * consistent with the data a job mutates, and there is no second stateful dependency
 * to run. The interface is deliberately narrow, so a BullMQ implementation could
 * replace it without touching callers.
 *
 * Concurrency safety comes from `FOR UPDATE SKIP LOCKED`: workers claim rows without
 * blocking each other and without ever handing the same job to two workers.
 */

export type EnqueueOptions = {
  type: JobType;
  payload: Prisma.InputJsonValue;
  /**
   * Stable key for the logical unit of work. Re-enqueueing the same key is a no-op,
   * which is what makes a retried request or a duplicated event harmless.
   */
  idempotencyKey: string;
  maxAttempts?: number;
  runAt?: Date;
};

/** Idempotent: an existing key wins, and the caller is told so. */
export async function enqueueJob(options: EnqueueOptions): Promise<{ created: boolean }> {
  try {
    await prisma.job.create({
      data: {
        type: options.type,
        payload: options.payload,
        idempotencyKey: options.idempotencyKey,
        maxAttempts: options.maxAttempts ?? env.JOB_MAX_ATTEMPTS,
        runAt: options.runAt ?? new Date(),
      },
    });

    return { created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Already queued or already run. Not an error — the work is already covered.
      logger.debug({ idempotencyKey: options.idempotencyKey }, "Job already enqueued; skipping");
      return { created: false };
    }

    throw error;
  }
}

/**
 * Atomically claims the next due job and increments its attempt counter.
 *
 * Only `PENDING` and `FAILED` jobs are eligible: `FAILED` means "retryable, waiting
 * for its next runAt", whereas `DEAD` is terminal.
 */
export async function claimNextJob(): Promise<Job | null> {
  const claimed = await prisma.$queryRaw<Job[]>`
    UPDATE "Job"
       SET status = 'RUNNING',
           attempts = attempts + 1,
           "lockedAt" = now(),
           "updatedAt" = now()
     WHERE id = (
       SELECT id
         FROM "Job"
        WHERE status IN ('PENDING', 'FAILED')
          AND "runAt" <= now()
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *
  `;

  return claimed[0] ?? null;
}

/**
 * Returns jobs whose worker died mid-run to the queue.
 *
 * Without this, a crashed worker would leave its job `RUNNING` forever and the work
 * would be silently lost.
 */
export async function reclaimStaleJobs(): Promise<number> {
  const staleBefore = new Date(Date.now() - env.JOB_LOCK_TIMEOUT_MS);

  const result = await prisma.$executeRaw`
    UPDATE "Job"
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'DEAD'::"JobStatus"
                         ELSE 'FAILED'::"JobStatus" END,
           "lastError" = 'Lock expired: the worker did not finish or report back',
           "lockedAt" = NULL,
           "runAt" = now(),
           "updatedAt" = now()
     WHERE status = 'RUNNING'
       AND "lockedAt" < ${staleBefore}
  `;

  if (result > 0) {
    logger.warn({ count: result }, "Reclaimed jobs whose lock had expired");
  }

  return result;
}

/**
 * Puts an existing job back on the queue, for an explicit user-initiated retry.
 *
 * Reusing the row keeps exactly one job per unit of work — a retry button pressed
 * twice cannot leave the queue holding several copies of the same pipeline.
 */
export async function requeueJob(
  idempotencyKey: string,
  options: { resetAttempts?: boolean } = {},
): Promise<boolean> {
  const result = await prisma.job.updateMany({
    where: { idempotencyKey },
    data: {
      status: JobStatus.PENDING,
      runAt: new Date(),
      lockedAt: null,
      lastError: null,
      result: Prisma.DbNull,
      ...(options.resetAttempts ? { attempts: 0 } : {}),
    },
  });

  return result.count > 0;
}

export async function completeJob(id: string, result?: Prisma.InputJsonValue): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
      lockedAt: null,
      lastError: null,
      result,
    },
  });
}

function backoffMs(attempts: number): number {
  const exponential = env.JOB_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  // Jitter, so a batch of jobs that failed together does not retry in lockstep.
  const jitter = Math.random() * env.JOB_BACKOFF_BASE_MS;

  return Math.round(exponential + jitter);
}

export type FailOutcome = "retry" | "dead";

/**
 * Records a failed attempt, and decides whether it is worth retrying.
 *
 * `attempts` was already incremented at claim time, so reaching `maxAttempts` here
 * means this was the final permitted try.
 */
export async function failJob(job: Job, error: unknown): Promise<FailOutcome> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DEAD,
        lockedAt: null,
        lastError: message.slice(0, 1000),
      },
    });

    logger.error(
      { jobId: job.id, type: job.type, attempts: job.attempts, err: error },
      "Job exhausted its attempts and was dead-lettered",
    );

    return "dead";
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JobStatus.FAILED,
      lockedAt: null,
      lastError: message.slice(0, 1000),
      runAt: new Date(Date.now() + backoffMs(job.attempts)),
    },
  });

  logger.warn(
    { jobId: job.id, type: job.type, attempts: job.attempts, err: error },
    "Job failed; scheduled for retry",
  );

  return "retry";
}

export type JobCounts = Record<JobStatus, number>;

export async function countJobsByStatus(): Promise<JobCounts> {
  const rows = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });

  const counts = {
    [JobStatus.PENDING]: 0,
    [JobStatus.RUNNING]: 0,
    [JobStatus.COMPLETED]: 0,
    [JobStatus.FAILED]: 0,
    [JobStatus.DEAD]: 0,
  } as JobCounts;

  for (const row of rows) {
    counts[row.status] = row._count._all;
  }

  return counts;
}
