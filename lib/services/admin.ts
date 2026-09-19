import { JobStatus, Prisma, type User } from "@prisma/client";
import { checkDatabaseConnection, prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { countJobsByStatus, requeueJob, type JobCounts } from "@/lib/jobs/queue";
import { env } from "@/lib/config";
import { bucketByDay, type DayBucket } from "@/lib/analytics/series";
import type { EvalReport } from "@/lib/eval/report";

/**
 * Admin reads.
 *
 * Every exported function calls `requireAdmin` first, so a route cannot forget it — the
 * same discipline the project-scoped services apply with ownership asserts.
 *
 * The acceptance criterion for this phase lives in `getUserJourney`: one user, traced from
 * activity through assessment and mastery to AI usage.
 */

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  spaces: number;
  projects: number;
  materials: number;
  concepts: number;
  quizzes: number;
  aiCalls: number;
  lastActivityAt: string | null;
};

export type AdminUserList = {
  users: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listUsers(
  admin: Pick<User, "role">,
  options: { query?: string; page?: number; pageSize?: number } = {},
): Promise<AdminUserList> {
  requireAdmin(admin);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, options.pageSize ?? 20));
  const query = options.query?.trim();

  const where: Prisma.UserWhereInput = query
    ? {
        OR: [
          { email: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { spaces: true } },
      },
    }),
  ]);

  const ids = users.map((user) => user.id);

  if (ids.length === 0) {
    return { users: [], total, page, pageSize };
  }

  // Four grouped queries for the whole page, rather than four per user.
  const [projects, aiCalls, lastActivity] = await Promise.all([
    prisma.project.findMany({
      where: { space: { userId: { in: ids } } },
      select: {
        space: { select: { userId: true } },
        _count: { select: { materials: true, concepts: true, quizzes: true } },
      },
    }),
    prisma.aiRequest.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _max: { createdAt: true },
    }),
  ]);

  const totals = new Map<string, { projects: number; materials: number; concepts: number; quizzes: number }>();
  for (const project of projects) {
    const userId = project.space.userId;
    const entry = totals.get(userId) ?? { projects: 0, materials: 0, concepts: 0, quizzes: 0 };
    entry.projects += 1;
    entry.materials += project._count.materials;
    entry.concepts += project._count.concepts;
    entry.quizzes += project._count.quizzes;
    totals.set(userId, entry);
  }

  const aiByUser = new Map(aiCalls.map((row) => [row.userId, row._count._all]));
  const activityByUser = new Map(lastActivity.map((row) => [row.userId, row._max.createdAt]));

  return {
    users: users.map((user) => {
      const counts = totals.get(user.id) ?? { projects: 0, materials: 0, concepts: 0, quizzes: 0 };

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        spaces: user._count.spaces,
        projects: counts.projects,
        materials: counts.materials,
        concepts: counts.concepts,
        quizzes: counts.quizzes,
        aiCalls: aiByUser.get(user.id) ?? 0,
        lastActivityAt: activityByUser.get(user.id)?.toISOString() ?? null,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export type AdminFilterOptions = {
  users: Array<{ id: string; name: string; email: string }>;
  projects: Array<{ id: string; name: string; spaceName: string }>;
};

/** Populates the activity feed's filter controls. Bounded, like every admin list. */
export async function listFilterOptions(admin: Pick<User, "role">): Promise<AdminFilterOptions> {
  requireAdmin(admin);

  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, email: true },
    }),
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, name: true, space: { select: { name: true } } },
    }),
  ]);

  return {
    users,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      spaceName: project.space.name,
    })),
  };
}

// ---------------------------------------------------------------------------
// Per-user journey — the phase's acceptance criterion
// ---------------------------------------------------------------------------

export type JourneyActivityItem = {
  id: string;
  type: string;
  createdAt: string;
  projectId: string | null;
  payload: unknown;
};

export type UserJourney = {
  user: { id: string; email: string; name: string; role: string; createdAt: string };
  projects: Array<{ id: string; name: string; spaceId: string; spaceName: string }>;
  activity: {
    total: number;
    byType: Array<{ type: string; count: number }>;
    recent: JourneyActivityItem[];
  };
  assessments: {
    quizzesStarted: number;
    quizzesCompleted: number;
    answersGraded: number;
    averageScore: number | null;
    recent: Array<{ quizTitle: string | null; score: number | null; isCorrect: boolean | null; at: string }>;
  };
  mastery: {
    average: number;
    concepts: Array<{ name: string; mastery: number; projectName: string }>;
  };
  ai: {
    calls: number;
    failures: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    averageLatencyMs: number;
    byFeature: Array<{ feature: string; calls: number; failures: number }>;
  };
};

export async function getUserJourney(
  admin: Pick<User, "role">,
  userId: string,
): Promise<UserJourney> {
  requireAdmin(admin);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!user) throw new NotFoundError("User");

  const [
    projects,
    activityTotal,
    activityByTypeRows,
    recentActivity,
    quizCounts,
    answerStats,
    recentAnswers,
    concepts,
    aiAggregate,
    aiFailures,
    aiByFeature,
  ] = await Promise.all([
    prisma.project.findMany({
      where: { space: { userId } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, spaceId: true, space: { select: { name: true } } },
    }),
    prisma.activityEvent.count({ where: { userId } }),
    prisma.activityEvent.groupBy({ by: ["type"], where: { userId }, _count: { _all: true } }),
    prisma.activityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, type: true, createdAt: true, projectId: true, payload: true },
    }),
    prisma.quiz.groupBy({ by: ["status"], where: { project: { space: { userId } } }, _count: { _all: true } }),
    prisma.quizAnswer.aggregate({
      where: { question: { quiz: { project: { space: { userId } } } } },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.quizAnswer.findMany({
      where: { question: { quiz: { project: { space: { userId } } } } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        score: true,
        isCorrect: true,
        createdAt: true,
        question: { select: { quiz: { select: { title: true } } } },
      },
    }),
    prisma.concept.findMany({
      where: { project: { space: { userId } } },
      orderBy: { mastery: "asc" },
      take: 20,
      select: { name: true, mastery: true, project: { select: { name: true } } },
    }),
    prisma.aiRequest.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiRequest.count({ where: { userId, status: "FAILED" } }),
    prisma.aiRequest.groupBy({
      by: ["feature", "status"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  const features = new Map<string, { feature: string; calls: number; failures: number }>();
  for (const row of aiByFeature) {
    const entry = features.get(row.feature) ?? { feature: row.feature, calls: 0, failures: 0 };
    entry.calls += row._count._all;
    if (row.status === "FAILED") entry.failures += row._count._all;
    features.set(row.feature, entry);
  }

  return {
    user: { ...user, createdAt: user.createdAt.toISOString() },
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      spaceId: project.spaceId,
      spaceName: project.space.name,
    })),
    activity: {
      total: activityTotal,
      byType: activityByTypeRows
        .map((row) => ({ type: row.type, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      recent: recentActivity.map((event) => ({
        id: event.id,
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        projectId: event.projectId,
        payload: event.payload,
      })),
    },
    assessments: {
      quizzesStarted: quizCounts.reduce((total, row) => total + row._count._all, 0),
      quizzesCompleted:
        quizCounts.find((row) => row.status === "COMPLETED")?._count._all ?? 0,
      answersGraded: answerStats._count._all,
      averageScore: answerStats._avg.score,
      recent: recentAnswers.map((answer) => ({
        quizTitle: answer.question.quiz.title,
        score: answer.score,
        isCorrect: answer.isCorrect,
        at: answer.createdAt.toISOString(),
      })),
    },
    mastery: {
      average:
        concepts.length > 0
          ? concepts.reduce((total, concept) => total + concept.mastery, 0) / concepts.length
          : 0,
      concepts: concepts.map((concept) => ({
        name: concept.name,
        mastery: concept.mastery,
        projectName: concept.project.name,
      })),
    },
    ai: {
      calls: aiAggregate._count._all,
      failures: aiFailures,
      promptTokens: aiAggregate._sum.promptTokens ?? 0,
      completionTokens: aiAggregate._sum.completionTokens ?? 0,
      costUsd: Number((aiAggregate._sum.costUsd ?? 0).toFixed(6)),
      averageLatencyMs: Math.round(aiAggregate._avg.latencyMs ?? 0),
      byFeature: [...features.values()].sort((a, b) => b.calls - a.calls),
    },
  };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type ActivityFilters = {
  userId?: string;
  spaceId?: string;
  projectId?: string;
  type?: string;
  since?: Date;
  until?: Date;
};

export type AdminActivityItem = JourneyActivityItem & {
  /** Carried so the feed can link straight into that user's journey. */
  userId: string;
  userEmail: string;
  userName: string;
  spaceId: string | null;
};

export async function listActivity(
  admin: Pick<User, "role">,
  filters: ActivityFilters & { page?: number; pageSize?: number } = {},
): Promise<{ items: AdminActivityItem[]; total: number; page: number; pageSize: number }> {
  requireAdmin(admin);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  const where: Prisma.ActivityEventWhereInput = {
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.spaceId ? { spaceId: filters.spaceId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    // `type` is a free-form string, so an unknown value simply matches nothing rather
    // than erroring — which is the right behaviour for a filter over historical data.
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.since || filters.until
      ? {
          createdAt: {
            ...(filters.since ? { gte: filters.since } : {}),
            ...(filters.until ? { lte: filters.until } : {}),
          },
        }
      : {}),
  };

  const [total, events] = await Promise.all([
    prisma.activityEvent.count({ where }),
    prisma.activityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        createdAt: true,
        projectId: true,
        spaceId: true,
        payload: true,
        userId: true,
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  return {
    items: events.map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      projectId: event.projectId,
      spaceId: event.spaceId,
      payload: event.payload,
      userId: event.userId,
      userEmail: event.user.email,
      userName: event.user.name,
    })),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------

export type AdminJobSummary = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  idempotencyKey: string;
  runAt: string;
  lockedAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function listJobs(
  admin: Pick<User, "role">,
  options: { status?: JobStatus; limit?: number } = {},
): Promise<AdminJobSummary[]> {
  requireAdmin(admin);

  const limit = Math.min(200, Math.max(10, options.limit ?? 50));

  const jobs = await prisma.job.findMany({
    where: options.status ? { status: options.status } : {},
    // Dead letters and failures first: they are what an admin is here to find.
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      idempotencyKey: true,
      runAt: true,
      lockedAt: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return jobs.map((job) => ({
    ...job,
    runAt: job.runAt.toISOString(),
    lockedAt: job.lockedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  }));
}

/** Puts a failed or dead-lettered job back on the queue. */
export async function retryJob(admin: Pick<User, "role">, jobId: string): Promise<void> {
  requireAdmin(admin);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, idempotencyKey: true },
  });

  if (!job) throw new NotFoundError("Job");

  if (job.status !== JobStatus.FAILED && job.status !== JobStatus.DEAD) {
    throw new ConflictError(`Only failed or dead-lettered jobs can be retried (this one is ${job.status}).`);
  }

  await requeueJob(job.idempotencyKey, { resetAttempts: true });
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

export const STALE_LOCK_MULTIPLIER = 1;

export type SystemHealth = {
  database: boolean;
  jobs: JobCounts;
  /** `RUNNING` beyond the lock timeout — a crashed worker's leftovers. */
  staleRunning: number;
  oldestPendingAt: string | null;
  config: {
    environment: string;
    aiProvider: string;
    aiEmbedProvider: string;
    embedModel: string;
    embedDimensions: number;
    storageDriver: string;
    ocrEnabled: boolean;
    retrievalMinScore: number;
  };
  process: { uptimeSeconds: number; rssMb: number };
  checkedAt: string;
};

export async function getSystemHealth(admin: Pick<User, "role">): Promise<SystemHealth> {
  requireAdmin(admin);

  const staleBefore = new Date(Date.now() - env.JOB_LOCK_TIMEOUT_MS * STALE_LOCK_MULTIPLIER);

  const [database, jobs, staleRunning, oldestPending] = await Promise.all([
    checkDatabaseConnection(),
    countJobsByStatus(),
    prisma.job.count({
      where: { status: JobStatus.RUNNING, lockedAt: { lt: staleBefore } },
    }),
    prisma.job.findFirst({
      where: { status: JobStatus.PENDING },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);

  return {
    database,
    jobs,
    staleRunning,
    oldestPendingAt: oldestPending?.runAt.toISOString() ?? null,
    config: {
      environment: env.NODE_ENV,
      aiProvider: env.AI_PROVIDER,
      aiEmbedProvider: env.AI_EMBED_PROVIDER,
      embedModel: env.AI_EMBED_MODEL,
      embedDimensions: env.AI_EMBED_DIMENSIONS,
      storageDriver: env.STORAGE_DRIVER,
      ocrEnabled: env.OCR_ENABLED,
      retrievalMinScore: env.RETRIEVAL_MIN_SCORE,
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AI usage
// ---------------------------------------------------------------------------

export type AiUsageView = {
  windowDays: number;
  totals: {
    calls: number;
    failures: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    averageLatencyMs: number;
  };
  series: DayBucket[];
  byFeature: Array<{ feature: string; calls: number; failures: number; averageLatencyMs: number }>;
  byModel: Array<{ model: string; calls: number; averageLatencyMs: number }>;
  recentFailures: Array<{ at: string; feature: string; model: string; error: string | null }>;
};

export async function getAiUsage(
  admin: Pick<User, "role">,
  options: { days?: number } = {},
): Promise<AiUsageView> {
  requireAdmin(admin);

  const windowDays = Math.min(365, Math.max(1, options.days ?? 30));
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [aggregate, failures, byFeatureRows, byModel, series, recentFailures] = await Promise.all([
    prisma.aiRequest.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiRequest.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
    prisma.aiRequest.groupBy({
      by: ["feature", "status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiRequest.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiRequest.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.aiRequest.findMany({
      where: { createdAt: { gte: since }, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { createdAt: true, feature: true, model: true, error: true },
    }),
  ]);

  const features = new Map<string, { feature: string; calls: number; failures: number; latency: number }>();
  for (const row of byFeatureRows) {
    const entry = features.get(row.feature) ?? { feature: row.feature, calls: 0, failures: 0, latency: 0 };
    entry.calls += row._count._all;
    if (row.status === "FAILED") entry.failures += row._count._all;
    entry.latency += (row._avg.latencyMs ?? 0) * row._count._all;
    features.set(row.feature, entry);
  }

  return {
    windowDays,
    totals: {
      calls: aggregate._count._all,
      failures,
      promptTokens: aggregate._sum.promptTokens ?? 0,
      completionTokens: aggregate._sum.completionTokens ?? 0,
      costUsd: Number((aggregate._sum.costUsd ?? 0).toFixed(6)),
      averageLatencyMs: Math.round(aggregate._avg.latencyMs ?? 0),
    },
    series: bucketByDay(series, windowDays),
    byFeature: [...features.values()]
      .map((entry) => ({
        feature: entry.feature,
        calls: entry.calls,
        failures: entry.failures,
        averageLatencyMs: entry.calls > 0 ? Math.round(entry.latency / entry.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls),
    byModel: byModel
      .map((row) => ({
        model: row.model,
        calls: row._count._all,
        averageLatencyMs: Math.round(row._avg.latencyMs ?? 0),
      }))
      .sort((a, b) => b.calls - a.calls),
    recentFailures: recentFailures.map((row) => ({
      at: row.createdAt.toISOString(),
      feature: row.feature,
      model: row.model,
      error: row.error,
    })),
  };
}

/** The most recent completed evaluation run, stored as an `eval.run` job result. */
export async function getLatestEvaluation(
  admin: Pick<User, "role">,
): Promise<{ report: EvalReport; completedAt: string } | null> {
  requireAdmin(admin);

  const job = await prisma.job.findFirst({
    where: { type: "EVAL_RUN", status: JobStatus.COMPLETED },
    orderBy: { completedAt: "desc" },
    select: { result: true, completedAt: true },
  });

  if (!job?.result) return null;

  return {
    report: job.result as unknown as EvalReport,
    completedAt: (job.completedAt ?? new Date()).toISOString(),
  };
}
