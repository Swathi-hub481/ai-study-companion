import { MaterialStatus, QuizStatus, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertProjectAccess, requireAdmin } from "@/lib/auth/guards";
import { summarizeAiUsage } from "@/lib/ai/telemetry";
import { countJobsByStatus, type JobCounts } from "@/lib/jobs/queue";
import { bucketByDay, totalCount, type DayBucket } from "@/lib/analytics/series";

/**
 * Analytics.
 *
 * Two audiences with different scopes:
 *  - `getProjectAnalytics` is owner-scoped, exactly like every other project read.
 *  - `getGlobalAnalytics` is instance-wide and therefore admin-only (§8: "admin routes
 *    require `role = ADMIN`").
 *
 * Every query is either grouped in the database or windowed to a fixed number of days.
 * An analytics view is exactly the place where an unbounded scan would be tempting and
 * unacceptable.
 */

export const ANALYTICS_WINDOW_DAYS = 30;

export type AiUsageSummary = {
  calls: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  averageLatencyMs: number;
};

export type AiFeatureBreakdown = {
  feature: string;
  calls: number;
  failures: number;
  averageLatencyMs: number;
};

export type ActivityTypeBreakdown = {
  type: string;
  count: number;
};

/** Groups AI requests by feature, splitting successes from failures in one pass. */
async function aiByFeature(where: {
  projectId?: string;
  userId?: string;
}): Promise<AiFeatureBreakdown[]> {
  const rows = await prisma.aiRequest.groupBy({
    by: ["feature", "status"],
    where,
    _count: { _all: true },
    _avg: { latencyMs: true },
  });

  const byFeature = new Map<string, AiFeatureBreakdown>();

  for (const row of rows) {
    const entry = byFeature.get(row.feature) ?? {
      feature: row.feature,
      calls: 0,
      failures: 0,
      averageLatencyMs: 0,
    };

    entry.calls += row._count._all;
    if (row.status === "FAILED") entry.failures += row._count._all;
    // Weighted by call count, so a rarely-used feature's average is not overstated.
    entry.averageLatencyMs += (row._avg.latencyMs ?? 0) * row._count._all;
    byFeature.set(row.feature, entry);
  }

  return [...byFeature.values()]
    .map((entry) => ({
      ...entry,
      averageLatencyMs: entry.calls > 0 ? Math.round(entry.averageLatencyMs / entry.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);
}

async function activityByType(where: {
  projectId?: string;
  userId?: string;
  createdAt?: { gte: Date };
}): Promise<ActivityTypeBreakdown[]> {
  const rows = await prisma.activityEvent.groupBy({
    by: ["type"],
    where,
    _count: { _all: true },
  });

  return rows
    .map((row) => ({ type: row.type, count: row._count._all }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Project analytics (owner-scoped)
// ---------------------------------------------------------------------------

export type ProjectAnalytics = {
  windowDays: number;
  activity: DayBucket[];
  activityTotal: number;
  activityByType: ActivityTypeBreakdown[];
  assessment: {
    quizzesStarted: number;
    quizzesCompleted: number;
    answersGraded: number;
    averageScore: number | null;
    recentScores: Array<{ at: string; score: number; isCorrect: boolean | null }>;
  };
  mastery: {
    average: number;
    concepts: Array<{ id: string; name: string; mastery: number; importance: number }>;
  };
  materials: { total: number; ready: number; failed: number };
  ai: AiUsageSummary & { byFeature: AiFeatureBreakdown[] };
};

export async function getProjectAnalytics(
  userId: string,
  projectId: string,
): Promise<ProjectAnalytics> {
  const project = await assertProjectAccess(userId, projectId);
  const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 86_400_000);

  const [
    events,
    byType,
    quizCounts,
    answerStats,
    recentAnswers,
    concepts,
    materialStatuses,
    ai,
    byFeature,
  ] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { projectId: project.id, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    activityByType({ projectId: project.id, createdAt: { gte: since } }),
    prisma.quiz.groupBy({
      by: ["status"],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
    prisma.quizAnswer.aggregate({
      where: { question: { quiz: { projectId: project.id } } },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.quizAnswer.findMany({
      where: { question: { quiz: { projectId: project.id } } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { createdAt: true, score: true, isCorrect: true },
    }),
    prisma.concept.findMany({
      where: { projectId: project.id },
      orderBy: { mastery: "desc" },
      select: { id: true, name: true, mastery: true, importance: true },
    }),
    prisma.material.groupBy({
      by: ["status"],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
    summarizeAiUsage({ projectId: project.id }),
    // Independent of the aggregate above, so it belongs in the same round trip
    // rather than adding a second one after it.
    aiByFeature({ projectId: project.id }),
  ]);

  const quizzesStarted = quizCounts.reduce((total, row) => total + row._count._all, 0);
  const quizzesCompleted =
    quizCounts.find((row) => row.status === QuizStatus.COMPLETED)?._count._all ?? 0;
  const countByStatus = (status: MaterialStatus) =>
    materialStatuses.find((row) => row.status === status)?._count._all ?? 0;

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    activity: bucketByDay(events, ANALYTICS_WINDOW_DAYS),
    activityTotal: events.length,
    activityByType: byType,
    assessment: {
      quizzesStarted,
      quizzesCompleted,
      answersGraded: answerStats._count._all,
      averageScore: answerStats._avg.score,
      // Ungraded answers are not a zero, they are absent — so they are excluded rather
      // than plotted as failures.
      recentScores: recentAnswers
        .filter(
          (answer): answer is typeof answer & { score: number } => typeof answer.score === "number",
        )
        .map((answer) => ({
          at: answer.createdAt.toISOString(),
          score: answer.score,
          isCorrect: answer.isCorrect,
        })),
    },
    mastery: {
      average:
        concepts.length > 0
          ? concepts.reduce((total, concept) => total + concept.mastery, 0) / concepts.length
          : 0,
      concepts,
    },
    materials: {
      total: materialStatuses.reduce((total, row) => total + row._count._all, 0),
      ready: countByStatus(MaterialStatus.READY),
      failed: countByStatus(MaterialStatus.FAILED),
    },
    ai: { ...ai, byFeature },
  };
}

// ---------------------------------------------------------------------------
// Global analytics (admin-only)
// ---------------------------------------------------------------------------

export type GlobalAnalytics = {
  windowDays: number;
  totals: {
    users: number;
    admins: number;
    spaces: number;
    projects: number;
    materials: number;
    readyMaterials: number;
    concepts: number;
    conversations: number;
    quizzes: number;
    quizzesCompleted: number;
  };
  mastery: { average: number };
  activity: DayBucket[];
  activityTotal: number;
  activityByType: ActivityTypeBreakdown[];
  ai: AiUsageSummary & {
    byFeature: AiFeatureBreakdown[];
    byProvider: Array<{ provider: string; calls: number }>;
  };
  jobs: JobCounts;
};

export async function getGlobalAnalytics(admin: Pick<User, "role">): Promise<GlobalAnalytics> {
  requireAdmin(admin);

  const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 86_400_000);

  const [
    users,
    admins,
    spaces,
    projects,
    materialStatuses,
    concepts,
    conversations,
    quizzes,
    masteryAggregate,
    events,
    byType,
    ai,
    byFeature,
    providers,
    jobs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.space.count(),
    prisma.project.count(),
    prisma.material.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.concept.count(),
    prisma.conversation.count(),
    prisma.quiz.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.concept.aggregate({ _avg: { mastery: true } }),
    prisma.activityEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    activityByType({ createdAt: { gte: since } }),
    summarizeAiUsage({}),
    aiByFeature({}),
    prisma.aiRequest.groupBy({ by: ["provider"], _count: { _all: true } }),
    countJobsByStatus(),
  ]);

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    totals: {
      users,
      admins,
      spaces,
      projects,
      materials: materialStatuses.reduce((total, row) => total + row._count._all, 0),
      readyMaterials:
        materialStatuses.find((row) => row.status === MaterialStatus.READY)?._count._all ?? 0,
      concepts,
      conversations,
      quizzes: quizzes.reduce((total, row) => total + row._count._all, 0),
      quizzesCompleted:
        quizzes.find((row) => row.status === QuizStatus.COMPLETED)?._count._all ?? 0,
    },
    mastery: { average: masteryAggregate._avg.mastery ?? 0 },
    activity: bucketByDay(events, ANALYTICS_WINDOW_DAYS),
    activityTotal: totalCount(bucketByDay(events, ANALYTICS_WINDOW_DAYS)),
    activityByType: byType,
    ai: {
      ...ai,
      byFeature,
      byProvider: providers
        .map((row) => ({ provider: row.provider, calls: row._count._all }))
        .sort((a, b) => b.calls - a.calls),
    },
    jobs,
  };
}
