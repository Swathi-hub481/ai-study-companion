import type { JobType } from "@prisma/client";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getHandler } from "@/lib/jobs/handlers";
import { claimNextJob, completeJob, failJob, reclaimStaleJobs } from "@/lib/jobs/queue";

/**
 * The worker loop.
 *
 * `runWorkerOnce` and `drainQueue` are exported separately from the long-running loop
 * so tests can advance the queue deterministically instead of waiting on a timer.
 */

export type WorkerStepResult =
  | { processed: false }
  | {
      processed: true;
      jobId: string;
      type: JobType;
      outcome: "completed" | "retry" | "dead";
    };

/** Claims and runs a single job, if one is due. */
export async function runWorkerOnce(): Promise<WorkerStepResult> {
  const job = await claimNextJob();

  if (!job) {
    return { processed: false };
  }

  const startedAt = Date.now();

  try {
    const handler = getHandler(job.type);
    const result = await handler(job);

    await completeJob(job.id, result);

    logger.info(
      { jobId: job.id, type: job.type, attempt: job.attempts, durationMs: Date.now() - startedAt },
      "Job completed",
    );

    return { processed: true, jobId: job.id, type: job.type, outcome: "completed" };
  } catch (error) {
    const outcome = await failJob(job, error);

    return { processed: true, jobId: job.id, type: job.type, outcome };
  }
}

export type DrainSummary = {
  processed: number;
  completed: number;
  retried: number;
  dead: number;
};

/**
 * Runs jobs until the queue has nothing due.
 *
 * Terminates naturally: a job that fails is rescheduled into the future, so it stops
 * being eligible and the loop ends rather than spinning on it.
 */
export async function drainQueue(options: { maxJobs?: number } = {}): Promise<DrainSummary> {
  const maxJobs = options.maxJobs ?? 100;
  const summary: DrainSummary = { processed: 0, completed: 0, retried: 0, dead: 0 };

  await reclaimStaleJobs();

  while (summary.processed < maxJobs) {
    const step = await runWorkerOnce();

    if (!step.processed) break;

    summary.processed += 1;
    if (step.outcome === "completed") summary.completed += 1;
    if (step.outcome === "retry") summary.retried += 1;
    if (step.outcome === "dead") summary.dead += 1;
  }

  return summary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Long-running loop for `npm run worker`. Stops promptly on SIGINT/SIGTERM. */
export async function runWorkerLoop(signal: AbortSignal): Promise<void> {
  logger.info({ pollMs: env.JOB_POLL_MS }, "Worker started");

  let lastReclaim = 0;

  while (!signal.aborted) {
    try {
      // Periodically rescue jobs whose worker died mid-run.
      if (Date.now() - lastReclaim > env.JOB_LOCK_TIMEOUT_MS) {
        await reclaimStaleJobs();
        lastReclaim = Date.now();
      }

      const step = await runWorkerOnce();

      if (!step.processed) {
        await sleep(env.JOB_POLL_MS);
      }
    } catch (error) {
      // A failure here is a queue-level problem (database unreachable, say), not a
      // job failure. Back off instead of spinning and flooding the log.
      logger.error({ err: error }, "Worker iteration failed");
      await sleep(env.JOB_POLL_MS);
    }
  }

  logger.info("Worker stopped");
}
