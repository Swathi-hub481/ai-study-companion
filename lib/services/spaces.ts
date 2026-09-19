import { MaterialStatus, type Project, type Space } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertSpaceAccess } from "@/lib/auth/guards";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import {
  summarizeProjectMastery,
  type ActivityItem,
  type ProjectMasteryStat,
} from "@/lib/services/projects";
import type { SpaceCreateInput, SpaceUpdateInput } from "@/lib/validation/spaces";

/** Spaces — broad learning areas. All operations resolve ownership first. */

export type SpaceSummary = {
  space: Space;
  projectCount: number;
  materialCount: number;
  conceptCount: number;
  averageMastery: number;
};

export async function createSpace(userId: string, input: SpaceCreateInput): Promise<Space> {
  return prisma.$transaction(async (tx) => {
    const space = await tx.space.create({
      data: {
        userId,
        name: input.name,
        description: input.description,
        color: input.color ?? null,
        icon: input.icon ?? null,
      },
    });

    await recordActivity(tx, {
      userId,
      type: ActivityType.SPACE_CREATED,
      spaceId: space.id,
      payload: { name: space.name },
    });

    return space;
  });
}

export async function updateSpace(
  userId: string,
  spaceId: string,
  input: SpaceUpdateInput,
): Promise<Space> {
  const space = await assertSpaceAccess(userId, spaceId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.space.update({ where: { id: space.id }, data: input });

    await recordActivity(tx, {
      userId,
      type: ActivityType.SPACE_UPDATED,
      spaceId: space.id,
      payload: { fields: Object.keys(input) },
    });

    return updated;
  });
}

export async function deleteSpace(userId: string, spaceId: string): Promise<void> {
  const space = await assertSpaceAccess(userId, spaceId);

  await prisma.$transaction(async (tx) => {
    await tx.space.delete({ where: { id: space.id } });

    // The Space row is gone, so the event carries the name in its payload. Its own
    // spaceId is nulled by the FK; the event itself survives for the audit trail.
    await recordActivity(tx, {
      userId,
      type: ActivityType.SPACE_DELETED,
      payload: { name: space.name },
    });
  });
}

export async function getSpace(userId: string, spaceId: string): Promise<Space> {
  return assertSpaceAccess(userId, spaceId);
}

/**
 * Space list with rolled-up progress. Uses grouped queries rather than per-Space
 * queries so the cost stays flat as the number of Spaces grows.
 */
export async function listSpaces(userId: string): Promise<SpaceSummary[]> {
  const spaces = await prisma.space.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { projects: true } } },
  });

  if (spaces.length === 0) return [];

  const projects = await prisma.project.findMany({
    where: { spaceId: { in: spaces.map((space) => space.id) } },
    select: {
      id: true,
      spaceId: true,
      _count: { select: { materials: true, concepts: true } },
    },
  });

  const mastery = await summarizeProjectMastery(projects.map((project) => project.id));

  return spaces.map((space) => {
    const own = projects.filter((project) => project.spaceId === space.id);
    const masteryValues = own
      .map((project) => mastery.get(project.id)?.averageMastery)
      .filter((value): value is number => value !== undefined);

    return {
      space,
      projectCount: space._count.projects,
      materialCount: own.reduce((total, project) => total + project._count.materials, 0),
      conceptCount: own.reduce((total, project) => total + project._count.concepts, 0),
      averageMastery:
        masteryValues.length > 0
          ? masteryValues.reduce((total, value) => total + value, 0) / masteryValues.length
          : 0,
    };
  });
}

export type SpaceDashboard = {
  space: Space;
  projects: Array<{
    project: Project;
    mastery: ProjectMasteryStat;
    materialCount: number;
    failedMaterials: number;
    lastActivityAt: Date | null;
  }>;
  activity: ActivityItem[];
  totals: {
    projects: number;
    materials: number;
    readyMaterials: number;
    concepts: number;
    averageMastery: number;
    needsAttention: number;
  };
};

export async function getSpaceDashboard(
  userId: string,
  spaceId: string,
): Promise<SpaceDashboard> {
  const space = await assertSpaceAccess(userId, spaceId);

  const [projects, materialRows, activity, lastActivity] = await Promise.all([
    prisma.project.findMany({
      where: { spaceId: space.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { materials: true, concepts: true } } },
    }),
    prisma.material.groupBy({
      by: ["projectId", "status"],
      where: { project: { spaceId: space.id } },
      _count: { _all: true },
    }),
    prisma.activityEvent.findMany({
      // Space-level events, plus events belonging to any Project in this Space.
      where: { OR: [{ spaceId: space.id }, { project: { spaceId: space.id } }] },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, type: true, createdAt: true, payload: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["projectId"],
      where: { project: { spaceId: space.id } },
      _max: { createdAt: true },
    }),
  ]);

  const mastery = await summarizeProjectMastery(projects.map((project) => project.id));
  const lastActivityByProject = new Map(
    lastActivity
      .filter((row): row is typeof row & { projectId: string } => row.projectId !== null)
      .map((row) => [row.projectId, row._max.createdAt]),
  );

  const materialsForProject = (projectId: string) =>
    materialRows.filter((row) => row.projectId === projectId);

  const statusTotal = (projectId: string, status: MaterialStatus) =>
    materialsForProject(projectId)
      .filter((row) => row.status === status)
      .reduce((total, row) => total + row._count._all, 0);

  const totalMaterials = materialRows.reduce((total, row) => total + row._count._all, 0);
  const readyMaterials = materialRows
    .filter((row) => row.status === MaterialStatus.READY)
    .reduce((total, row) => total + row._count._all, 0);

  const masteryValues = projects
    .map((project) => mastery.get(project.id)?.averageMastery)
    .filter((value): value is number => value !== undefined);

  return {
    space,
    projects: projects.map((project) => ({
      project,
      mastery: mastery.get(project.id) ?? { averageMastery: 0, conceptCount: 0 },
      materialCount: materialsForProject(project.id).reduce(
        (total, row) => total + row._count._all,
        0,
      ),
      failedMaterials: statusTotal(project.id, MaterialStatus.FAILED),
      lastActivityAt: lastActivityByProject.get(project.id) ?? null,
    })),
    activity,
    totals: {
      projects: projects.length,
      materials: totalMaterials,
      readyMaterials,
      concepts: projects.reduce((total, project) => total + project._count.concepts, 0),
      averageMastery:
        masteryValues.length > 0
          ? masteryValues.reduce((total, value) => total + value, 0) / masteryValues.length
          : 0,
      // Projects with something wrong or unfinished — what the Space dashboard
      // should nudge the user about rather than showing a flat progress number.
      needsAttention: projects.filter(
        (project) =>
          statusTotal(project.id, MaterialStatus.FAILED) > 0 ||
          (mastery.get(project.id)?.averageMastery ?? 0) < 0.5,
      ).length,
    },
  };
}
