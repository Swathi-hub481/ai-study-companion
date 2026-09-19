import { JobType, type Job, type Prisma } from "@prisma/client";
import { z } from "zod";
import { JobError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/queue";
import { processMaterial } from "@/lib/services/materials";
import { evaluateQuiz } from "@/lib/services/quizzes";
import { refreshProjectMastery } from "@/lib/services/mastery";
import { generateForProject } from "@/lib/services/recommendations";
import { rebuildLearningContext, CONTEXT_JOB_IDS } from "@/lib/services/learning-context";
import { RECOMMENDATION_JOB_IDS } from "@/lib/services/recommendations";
import { runEvaluationSuites } from "@/lib/eval/run";

/**
 * Job handler registry.
 *
 * Handlers are looked up by type at run time. An unregistered type raises rather than
 * being ignored: a job that silently does nothing is far harder to notice than one
 * that fails loudly and lands in the dead-letter queue.
 */

export type JobHandler = (job: Job) => Promise<Prisma.InputJsonValue | undefined>;

/** Payloads are validated on the way in, like any other untrusted boundary input. */
const materialProcessPayload = z.object({ materialId: z.string().min(1) });
const quizEvaluatePayload = z.object({ quizId: z.string().min(1) });
const projectPayload = z.object({ projectId: z.string().min(1) });
const evalRunPayload = z.object({ projectId: z.string().min(1) });

const handlers: Partial<Record<JobType, JobHandler>> = {
  [JobType.MATERIAL_PROCESS]: async (job) => {
    const { materialId } = materialProcessPayload.parse(job.payload);
    const result = await processMaterial(materialId);

    return {
      pageCount: result.pageCount,
      chunkCount: result.chunkCount,
      conceptCount: result.conceptCount,
      ocrPages: result.ocrPages,
    };
  },

  /**
   * Runs after a quiz is completed.
   *
   * §7.3 and §9 give this job a chain: recompute mastery, detect weakness, produce
   * insight and recommendations. Mastery is recomputed here; the two derived products
   * are *queued* rather than called inline, so each one retries independently and a
   * failure to generate recommendations cannot lose the mastery recomputation.
   */
  [JobType.QUIZ_EVALUATE]: async (job) => {
    const { quizId } = quizEvaluatePayload.parse(job.payload);
    const result = await evaluateQuiz(quizId);

    if (result.projectId) {
      await enqueueJob({
        type: JobType.RECOMMEND_GENERATE,
        payload: { projectId: result.projectId, quizId },
        idempotencyKey: RECOMMENDATION_JOB_IDS.forQuiz(result.projectId, quizId),
      });

      await enqueueJob({
        type: JobType.CONTEXT_REFRESH,
        payload: { projectId: result.projectId },
        idempotencyKey: CONTEXT_JOB_IDS.forQuiz(result.projectId, quizId),
      });
    }

    return {
      concepts: result.concepts,
      changed: result.changes.filter((change) => change.before !== change.after).length,
      followedUp: Boolean(result.projectId),
    };
  },

  /** Recomputes mastery from evidence, then refreshes the curated `LearningContext`. */
  [JobType.MASTERY_UPDATE]: async (job) => {
    const { projectId } = projectPayload.parse(job.payload);
    const result = await refreshProjectMastery(projectId);

    return {
      concepts: result.concepts,
      changed: result.changed,
      strengths: result.context.strengths,
      weaknesses: result.context.weaknesses,
      repeatedMistakes: result.context.repeatedMistakes,
      summarised: result.context.summarised,
    };
  },

  /** Turns the learner's current state into a small set of next-best actions. */
  [JobType.RECOMMEND_GENERATE]: async (job) => {
    const { projectId } = projectPayload.parse(job.payload);
    const result = await generateForProject(projectId);

    return { created: result.created, concepts: result.concepts };
  },

  /** Rebuilds the curated context slice (deterministic fields, plus a summary). */
  [JobType.CONTEXT_REFRESH]: async (job) => {
    const { projectId } = projectPayload.parse(job.payload);
    const result = await rebuildLearningContext(projectId);

    return {
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      repeatedMistakes: result.repeatedMistakes,
      summarised: result.summarised,
    };
  },

  /**
   * Runs the §10.5 evaluation suites and stores the report as this job's result.
   *
   * The job is the store: the admin view reads the latest completed run from here, which
   * avoids a table that would hold one row per manual run.
   */
  [JobType.EVAL_RUN]: async (job) => {
    const { projectId } = evalRunPayload.parse(job.payload);
    const report = await runEvaluationSuites(projectId);

    return report as unknown as Prisma.InputJsonValue;
  },
};

export function getHandler(type: JobType): JobHandler {
  const handler = handlers[type];

  if (!handler) {
    throw new JobError(
      `No handler is registered for job type "${type}". Register one in lib/jobs/handlers.ts.`,
    );
  }

  return handler;
}

export function registeredJobTypes(): JobType[] {
  return Object.keys(handlers) as JobType[];
}
