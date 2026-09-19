import { MaterialStatus, QuizStatus, type Project, type Space } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertProjectAccess, assertSpaceAccess } from "@/lib/auth/guards";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import { computeNextStep } from "@/lib/learning/next-step";
import { fromNextStep, fromRecommendation, type NextAction } from "@/lib/learning/next-action";
import type { RecommendationView } from "@/lib/learning/recommendation";
import { listForProject } from "@/lib/services/recommendations";
import type { ProjectCreateInput, ProjectUpdateInput } from "@/lib/validation/projects";

/**
 * Projects — the core learning workspace, and the isolation boundary.
 *
 * Every exported function takes `userId` first and resolves ownership before doing
 * anything, so no caller can forget the check.
 */

export type ActivityItem = {
  id: string;
  type: string;
  createdAt: Date;
  payload: unknown;
};

export type ProjectMasteryStat = {
  averageMastery: number;
  conceptCount: number;
};

/** How many top-importance concepts are considered when picking the weakest. */
const WEAKEST_CONCEPT_POOL = 12;

/** Rolls a `groupBy(status)` result into the three counts the rule engine needs. */
function summariseMaterialStatuses(
  rows: Array<{ status: MaterialStatus; _count: { _all: number } }>,
): { total: number; ready: number; failed: number } {
  const countFor = (status: MaterialStatus) =>
    rows.find((row) => row.status === status)?._count._all ?? 0;

  return {
    total: rows.reduce((total, row) => total + row._count._all, 0),
    ready: countFor(MaterialStatus.READY),
    failed: countFor(MaterialStatus.FAILED),
  };
}

/**
 * The single "what should I do next?" value.
 *
 * Both the Project dashboard and the lighter `getProjectNextAction` build it through
 * here, so the two entry points cannot drift apart in what they recommend.
 */
function buildNextAction(params: {
  materialCount: number;
  readyMaterialCount: number;
  failedMaterialCount: number;
  conceptCount: number;
  quizzesCompleted: number;
  weakestConcept: { name: string; mastery: number } | null;
  recommendations: RecommendationView[];
}): NextAction {
  // Open first (the service orders by status), so the first open one is the best.
  const openRecommendation =
    params.recommendations.find((entry) => entry.status === "OPEN") ?? null;

  if (openRecommendation) return fromRecommendation(openRecommendation);

  return fromNextStep(
    computeNextStep({
      materialCount: params.materialCount,
      readyMaterialCount: params.readyMaterialCount,
      failedMaterialCount: params.failedMaterialCount,
      conceptCount: params.conceptCount,
      quizzesCompleted: params.quizzesCompleted,
      weakestConcept: params.weakestConcept,
    }),
  );
}

/**
 * Average mastery and concept count per Project, in one grouped query rather than
 * N queries — the dashboards need this for every tile they render.
 */
export async function summarizeProjectMastery(
  projectIds: string[],
): Promise<Map<string, ProjectMasteryStat>> {
  if (projectIds.length === 0) return new Map();

  const rows = await prisma.concept.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds } },
    _avg: { mastery: true },
    _count: { _all: true },
  });

  return new Map(
    rows.map((row) => [
      row.projectId,
      { averageMastery: row._avg.mastery ?? 0, conceptCount: row._count._all },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Project dashboard
// ---------------------------------------------------------------------------

export type ProjectDashboard = {
  project: Project;
  space: Pick<Space, "id" | "name" | "color">;
  counts: {
    materials: number;
    readyMaterials: number;
    failedMaterials: number;
    concepts: number;
    conversations: number;
  };
  mastery: {
    average: number;
    concepts: Array<{ id: string; name: string; mastery: number; importance: number }>;
  };
  performance: {
    answersGraded: number;
    averageScore: number | null;
    quizzesCompleted: number;
  };
  activity: ActivityItem[];
  /**
   * What to do next: a generated recommendation when one is open, otherwise the
   * deterministic heuristic. `source` says which, so the UI can be honest about it.
   */
  nextAction: NextAction;
  recommendations: RecommendationView[];
};

export async function getProjectDashboard(
  userId: string,
  projectId: string,
): Promise<ProjectDashboard> {
  const project = await assertProjectAccess(userId, projectId);

  const [
    space,
    materialStatuses,
    conceptCount,
    conversationCount,
    concepts,
    answerStats,
    quizzesCompleted,
    activity,
    recommendations,
  ] = await Promise.all([
    prisma.space.findUniqueOrThrow({
      where: { id: project.spaceId },
      select: { id: true, name: true, color: true },
    }),
    prisma.material.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.concept.count({ where: { projectId } }),
    prisma.conversation.count({ where: { projectId } }),
    prisma.concept.findMany({
      where: { projectId },
      orderBy: [{ importance: "desc" }, { mastery: "asc" }],
      take: WEAKEST_CONCEPT_POOL,
      select: { id: true, name: true, mastery: true, importance: true },
    }),
    prisma.quizAnswer.aggregate({
      where: { question: { quiz: { projectId } } },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.quiz.count({ where: { projectId, status: QuizStatus.COMPLETED } }),
    prisma.activityEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, type: true, createdAt: true, payload: true },
    }),
    // Independent of everything above, so it belongs in the same round trip rather
    // than adding one after it.
    listForProject(projectId),
  ]);

  const materials = summariseMaterialStatuses(materialStatuses);

  const weakest = [...concepts].sort((a, b) => a.mastery - b.mastery)[0] ?? null;

  const averageMastery =
    concepts.length > 0
      ? concepts.reduce((total, concept) => total + concept.mastery, 0) / concepts.length
      : 0;

  return {
    project,
    space,
    counts: {
      materials: materials.total,
      readyMaterials: materials.ready,
      failedMaterials: materials.failed,
      concepts: conceptCount,
      conversations: conversationCount,
    },
    mastery: {
      average: averageMastery,
      concepts,
    },
    performance: {
      answersGraded: answerStats._count._all,
      averageScore: answerStats._avg.score,
      quizzesCompleted,
    },
    activity,
    // A generated suggestion when there is one; the rule engine otherwise, so the
    // dashboard always has something defensible to say.
    nextAction: buildNextAction({
      materialCount: materials.total,
      readyMaterialCount: materials.ready,
      failedMaterialCount: materials.failed,
      conceptCount,
      quizzesCompleted,
      weakestConcept: weakest ? { name: weakest.name, mastery: weakest.mastery } : null,
      recommendations,
    }),
    recommendations,
  };
}

/**
 * Just the "what next" value, for callers that do not need a whole dashboard.
 *
 * Home shows the next action for the project the learner last touched, and building the
 * full dashboard for that costs eight queries whose results are then discarded. This
 * asks only what the rule engine and the recommendation list actually read — and builds
 * the answer through the same `buildNextAction` the dashboard uses, so the two cannot
 * disagree.
 */
export async function getProjectNextAction(userId: string, projectId: string): Promise<NextAction> {
  const project = await assertProjectAccess(userId, projectId);

  const [materialStatuses, conceptCount, quizzesCompleted, concepts, recommendations] =
    await Promise.all([
      prisma.material.groupBy({
        by: ["status"],
        where: { projectId: project.id },
        _count: { _all: true },
      }),
      prisma.concept.count({ where: { projectId: project.id } }),
      prisma.quiz.count({ where: { projectId: project.id, status: QuizStatus.COMPLETED } }),
      // The same ordering and window as the dashboard, so "weakest" resolves to the
      // same concept and therefore yields the same recommendation.
      prisma.concept.findMany({
        where: { projectId: project.id },
        orderBy: [{ importance: "desc" }, { mastery: "asc" }],
        take: WEAKEST_CONCEPT_POOL,
        select: { name: true, mastery: true },
      }),
      listForProject(project.id),
    ]);

  const materials = summariseMaterialStatuses(materialStatuses);
  const weakest = [...concepts].sort((a, b) => a.mastery - b.mastery)[0] ?? null;

  return buildNextAction({
    materialCount: materials.total,
    readyMaterialCount: materials.ready,
    failedMaterialCount: materials.failed,
    conceptCount,
    quizzesCompleted,
    weakestConcept: weakest,
    recommendations,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createProject(userId: string, input: ProjectCreateInput): Promise<Project> {
  const space = await assertSpaceAccess(userId, input.spaceId);

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        spaceId: space.id,
        name: input.name,
        description: input.description,
        goal: input.goal,
      },
    });

    // Created up front so later phases can update it without existence checks.
    await tx.learningContext.create({ data: { projectId: project.id } });

    await recordActivity(tx, {
      userId,
      type: ActivityType.PROJECT_CREATED,
      spaceId: space.id,
      projectId: project.id,
      payload: { name: project.name, goal: project.goal },
    });

    return project;
  });
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: ProjectUpdateInput,
): Promise<Project> {
  const project = await assertProjectAccess(userId, projectId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id: project.id }, data: input });

    await recordActivity(tx, {
      userId,
      type: ActivityType.PROJECT_UPDATED,
      spaceId: project.spaceId,
      projectId: project.id,
      payload: { fields: Object.keys(input) },
    });

    return updated;
  });
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const project = await assertProjectAccess(userId, projectId);

  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: project.id } });

    // Recorded with projectId null: the row is gone, and the event is the audit
    // trail that it existed. `spaceId` keeps it attributable in Space activity.
    await recordActivity(tx, {
      userId,
      type: ActivityType.PROJECT_DELETED,
      spaceId: project.spaceId,
      payload: { name: project.name },
    });
  });
}

export async function listProjectsForSpace(userId: string, spaceId: string) {
  const space = await assertSpaceAccess(userId, spaceId);

  const projects = await prisma.project.findMany({
    where: { spaceId: space.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { materials: true, concepts: true, quizzes: true } },
    },
  });

  const mastery = await summarizeProjectMastery(projects.map((project) => project.id));

  return projects.map((project) => ({
    project,
    mastery: mastery.get(project.id) ?? { averageMastery: 0, conceptCount: 0 },
  }));
}
