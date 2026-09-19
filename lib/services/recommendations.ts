import { JobType, QuizStatus, RecommendationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertProjectAccess } from "@/lib/auth/guards";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import { enqueueJob } from "@/lib/jobs/queue";
import { generateRecommendations as generateRecommendationsFeature } from "@/lib/ai/features/generate-recommendations";
import { getGrowthForProject } from "@/lib/services/growth";
import { getContextSlice } from "@/lib/services/learning-context";
import type { RecommendationView } from "@/lib/learning/recommendation";

/**
 * Recommendations — the "what should I do next?" answer, generated rather than derived.
 *
 * The generation is grounded in the learner's actual state (mastery, trend, assessment
 * history, known weaknesses), and the open set is *replaced* on each run. That keeps a
 * retried job from accumulating duplicates, and keeps `DONE`/`DISMISSED` history intact.
 */

/**
 * Bounds applied when persisting.
 *
 * The schema asks for brevity but cannot enforce it (a hard `maxLength` becomes a 400
 * when a model overshoots), so the store is where the guarantee lives.
 */
const RECOMMENDATION_LIMITS = { title: 120, body: 600, reason: 300 } as const;

export const RECOMMENDATION_JOB_IDS = {
  forQuiz: (projectId: string, quizId: string) => `recommend:${projectId}:quiz:${quizId}`,
  /**
   * A manual refresh is bucketed to the minute so an impatient double-click cannot queue
   * a storm of generations, while still letting a learner ask again shortly after.
   */
  manual: (projectId: string, now: Date = new Date()) =>
    `recommend:${projectId}:manual:${Math.floor(now.getTime() / 60_000)}`,
};

export async function listRecommendations(
  userId: string,
  projectId: string,
): Promise<RecommendationView[]> {
  const project = await assertProjectAccess(userId, projectId);

  return listForProject(project.id);
}

/**
 * Unguarded read, for callers that have already resolved ownership (the dashboard,
 * which has just asserted access). Never expose this to a route directly.
 */
export async function listForProject(projectId: string): Promise<RecommendationView[]> {
  const recommendations = await prisma.recommendation.findMany({
    where: { projectId },
    // Status enum order is OPEN, DONE, DISMISSED — so open ones come first.
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 20,
    include: { concept: { select: { name: true } } },
  });

  return recommendations.map((recommendation) => ({
    id: recommendation.id,
    title: recommendation.title,
    body: recommendation.body,
    reason: recommendation.reason,
    priority: recommendation.priority,
    status: recommendation.status,
    conceptId: recommendation.conceptId,
    conceptName: recommendation.concept?.name ?? null,
    createdAt: recommendation.createdAt.toISOString(),
  }));
}

/** Queues a regeneration. The work happens in the worker, not in the request. */
export async function requestRecommendations(userId: string, projectId: string): Promise<void> {
  const project = await assertProjectAccess(userId, projectId);

  await enqueueJob({
    type: JobType.RECOMMEND_GENERATE,
    payload: { projectId: project.id },
    idempotencyKey: RECOMMENDATION_JOB_IDS.manual(project.id),
  });
}

export type GeneratedRecommendations = {
  created: number;
  concepts: number;
};

/**
 * The `recommend.generate` job body.
 *
 * Returns early when the project has no concepts: there is nothing to reason about, and
 * a model asked to recommend something from nothing would invent it.
 */
export async function generateForProject(projectId: string): Promise<GeneratedRecommendations> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      goal: true,
      spaceId: true,
      space: { select: { userId: true } },
    },
  });

  if (!project) return { created: 0, concepts: 0 };

  const userId = project.space.userId;

  const [growth, context, quizzesCompleted, answerStats] = await Promise.all([
    getGrowthForProject(projectId),
    getContextSlice(projectId),
    prisma.quiz.count({ where: { projectId, status: QuizStatus.COMPLETED } }),
    prisma.quizAnswer.aggregate({
      where: { question: { quiz: { projectId } } },
      _avg: { score: true },
      _count: { _all: true },
    }),
  ]);

  if (growth.length === 0) return { created: 0, concepts: 0 };

  const suggestions = await generateRecommendationsFeature(
    { userId, projectId },
    {
      project: { name: project.name, description: project.description, goal: project.goal },
      concepts: growth.map((concept) => ({
        name: concept.name,
        mastery: concept.mastery,
        band: concept.band,
        evidenceCount: concept.evidenceCount,
      })),
      performance: {
        quizzesCompleted,
        answersGraded: answerStats._count._all,
        averageScore: answerStats._avg.score,
      },
      strengths: context.strengths,
      weaknesses: context.weaknesses,
      repeatedMistakes: context.repeatedMistakes,
    },
  );

  // Names the model invented, or worded differently, simply do not link to a concept.
  const conceptIdByName = new Map(
    growth.map((concept) => [concept.name.toLowerCase(), concept.conceptId]),
  );

  await prisma.$transaction(async (tx) => {
    // Replace the open set: derived data, so superseding it is correct, and it keeps the
    // job idempotent. Resolved rows are history and are left alone.
    await tx.recommendation.deleteMany({
      where: { projectId, status: RecommendationStatus.OPEN },
    });

    for (const suggestion of suggestions) {
      const conceptId = suggestion.conceptName
        ? (conceptIdByName.get(suggestion.conceptName.toLowerCase()) ?? null)
        : null;

      await tx.recommendation.create({
        data: {
          projectId,
          conceptId,
          title: suggestion.title.slice(0, RECOMMENDATION_LIMITS.title),
          body: suggestion.body.slice(0, RECOMMENDATION_LIMITS.body),
          reason: suggestion.reason.slice(0, RECOMMENDATION_LIMITS.reason),
          priority: suggestion.priority,
          status: RecommendationStatus.OPEN,
        },
      });
    }

    await recordActivity(tx, {
      userId,
      type: ActivityType.RECOMMENDATION_CREATED,
      spaceId: project.spaceId,
      projectId,
      payload: { count: suggestions.length },
    });
  });

  return { created: suggestions.length, concepts: growth.length };
}
