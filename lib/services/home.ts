import { MaterialStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProjectNextAction, summarizeProjectMastery } from "@/lib/services/projects";
import { listSpaces, type SpaceSummary } from "@/lib/services/spaces";
import type { NextAction } from "@/lib/learning/next-action";

/**
 * Home dashboard aggregation.
 *
 * Answers the three product questions in one view: where was I (Continue Learning),
 * how am I doing (overall progress and attention areas), and what next (recommended
 * action).
 */

export type HomeProjectTile = {
  projectId: string;
  projectName: string;
  goal: string;
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  averageMastery: number;
  conceptCount: number;
  materialCount: number;
  updatedAt: Date;
};

export type HomeAttention = {
  conceptId: string;
  name: string;
  mastery: number;
  projectId: string;
  projectName: string;
  /** Carried here so the view can build a link without a second lookup. */
  spaceId: string;
};

export type HomeDashboard = {
  continueLearning: { tile: HomeProjectTile; nextAction: NextAction } | null;
  recentProjects: HomeProjectTile[];
  /**
   * The caller's Spaces. Home needs these so that creating a Space produces
   * immediate, visible feedback — without them, a user with a Space but no Project
   * yet would see the same empty state as a brand-new account.
   */
  spaces: SpaceSummary[];
  overall: {
    spaces: number;
    projects: number;
    concepts: number;
    readyMaterials: number;
    averageMastery: number;
  };
  attention: HomeAttention[];
};

const RECENT_PROJECT_LIMIT = 8;

/** Concepts below this are treated as needing attention. */
const ATTENTION_THRESHOLD = 0.6;

export async function getHomeDashboard(userId: string): Promise<HomeDashboard> {
  const [spaces, projects, conceptAggregate, readyMaterials, attentionConcepts, lastEvent] =
    await Promise.all([
      // Reuses the Spaces service so Home and the Spaces index can never disagree
      // about what the user owns or how far along it is.
      listSpaces(userId),
      prisma.project.findMany({
        where: { space: { userId } },
        orderBy: { updatedAt: "desc" },
        take: RECENT_PROJECT_LIMIT,
        include: {
          space: { select: { id: true, name: true, color: true } },
          _count: { select: { materials: true, concepts: true } },
        },
      }),
      prisma.concept.aggregate({
        where: { project: { space: { userId } } },
        _avg: { mastery: true },
        _count: { _all: true },
      }),
      prisma.material.count({
        where: { project: { space: { userId } }, status: MaterialStatus.READY },
      }),
      prisma.concept.findMany({
        where: { project: { space: { userId } }, mastery: { lt: ATTENTION_THRESHOLD } },
        orderBy: { mastery: "asc" },
        take: 5,
        select: {
          id: true,
          name: true,
          mastery: true,
          project: { select: { id: true, name: true, spaceId: true } },
        },
      }),
      // "Where was I" is best answered by the most recent learning activity, not by
      // the most recently *edited* Project — those differ once the user starts
      // studying rather than renaming things.
      prisma.activityEvent.findFirst({
        where: { userId, projectId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { projectId: true },
      }),
    ]);

  const mastery = await summarizeProjectMastery(projects.map((project) => project.id));

  const tiles: HomeProjectTile[] = projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    goal: project.goal,
    spaceId: project.space.id,
    spaceName: project.space.name,
    spaceColor: project.space.color,
    averageMastery: mastery.get(project.id)?.averageMastery ?? 0,
    conceptCount: mastery.get(project.id)?.conceptCount ?? project._count.concepts,
    materialCount: project._count.materials,
    updatedAt: project.updatedAt,
  }));

  const continueTile =
    tiles.find((tile) => tile.projectId === lastEvent?.projectId) ?? tiles[0] ?? null;

  // Reuse the Project dashboard's rule engine so the Home guidance and the Project
  // page can never disagree about what to do next. Asked for directly rather than via
  // `getProjectDashboard`, which would build — and discard — a whole dashboard for it.
  const continueLearning = continueTile
    ? {
        tile: continueTile,
        nextAction: await getProjectNextAction(userId, continueTile.projectId),
      }
    : null;

  return {
    continueLearning,
    recentProjects: tiles,
    spaces,
    overall: {
      spaces: spaces.length,
      projects: projects.length,
      concepts: conceptAggregate._count._all,
      readyMaterials,
      averageMastery: conceptAggregate._avg.mastery ?? 0,
    },
    attention: attentionConcepts.map((concept) => ({
      conceptId: concept.id,
      name: concept.name,
      mastery: concept.mastery,
      projectId: concept.project.id,
      projectName: concept.project.name,
      spaceId: concept.project.spaceId,
    })),
  };
}
