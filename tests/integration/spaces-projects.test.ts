import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project, Space, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { createSpace, deleteSpace, getSpaceDashboard, listSpaces } from "@/lib/services/spaces";
import { getHomeDashboard } from "@/lib/services/home";
import {
  createProject,
  deleteProject,
  getProjectDashboard,
  listProjectsForSpace,
} from "@/lib/services/projects";
import { waitForDatabase } from "../helpers/db";

/**
 * Spaces and Projects against a real database.
 *
 * The properties worth testing here are the ones a mock would happily fake:
 * ownership predicates inside the query, events written transactionally alongside
 * the change, and an audit trail that survives deletion.
 */

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

/** Narrows an ActivityEvent payload, which is typed as arbitrary JSON. */
function payloadName(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "name" in payload) {
    return String((payload as { name: unknown }).name);
  }
  return null;
}

function newUserData(label: string) {
  return {
    email: `p3-${label}-${runId}@example.com`,
    name: label,
    passwordHash: PLACEHOLDER_HASH,
  };
}

describe("spaces and projects", () => {
  let owner: User;
  let intruder: User;
  let ownerSpace: Space;
  /**
   * A dedicated project for the dashboard assertions. Selecting "whichever project
   * sorts first" would make the test depend on timestamp ordering between rows
   * created in the same millisecond.
   */
  let ownerProject: Project;

  beforeAll(async () => {
    await waitForDatabase();

    owner = await prisma.user.create({ data: newUserData("owner") });
    intruder = await prisma.user.create({ data: newUserData("intruder") });

    ownerSpace = await createSpace(owner.id, {
      name: `Owned space ${runId}`,
      description: "Owned by the owner.",
      color: "#6366f1",
    });

    ownerProject = await createProject(owner.id, {
      spaceId: ownerSpace.id,
      name: `Dashboard project ${runId}`,
      description: "Used for dashboard assertions.",
      goal: "Be able to justify a model choice.",
    });
  });

  afterAll(async () => {
    const ids = [owner?.id, intruder?.id].filter((id): id is string => Boolean(id));

    if (ids.length > 0) {
      // Activity events cascade from the user, so this clears them too.
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    // Deliberately no $disconnect(): lib/db.ts exposes a process-wide singleton, and
    // tearing it down here would pull the connection out from under whichever test
    // file runs next.
  });

  it("records a SPACE_CREATED event in the same transaction as the space", async () => {
    const events = await prisma.activityEvent.findMany({
      where: { spaceId: ownerSpace.id, type: "SPACE_CREATED" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBe(owner.id);
    expect(events[0]?.payload).toMatchObject({ name: ownerSpace.name });
  });

  it("rejects creating a project inside another user's space", async () => {
    await expect(
      createProject(intruder.id, {
        spaceId: ownerSpace.id,
        name: "Hijacked project",
        description: "Should never be created.",
        goal: "N/A",
      }),
    ).rejects.toThrow(NotFoundError);

    const created = await prisma.project.count({ where: { name: "Hijacked project" } });
    expect(created).toBe(0);
  });

  it("creates a project with a learning context and a creation event", async () => {
    const context = await prisma.learningContext.findUnique({
      where: { projectId: ownerProject.id },
    });
    expect(context).not.toBeNull();

    const events = await prisma.activityEvent.findMany({
      where: { projectId: ownerProject.id, type: "PROJECT_CREATED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.spaceId).toBe(ownerSpace.id);
  });

  it("requires a learning goal on the DTO rather than persisting an empty one", async () => {
    const project = await createProject(owner.id, {
      spaceId: ownerSpace.id,
      name: `Goal check ${runId}`,
      description: "Checks goal persistence.",
      goal: "Be able to justify a model choice.",
    });

    expect(project.goal).toBe("Be able to justify a model choice.");
  });

  it("returns only the caller's spaces", async () => {
    const intruderSpaces = await listSpaces(intruder.id);
    expect(intruderSpaces.map((entry) => entry.space.id)).not.toContain(ownerSpace.id);

    const ownerSpaces = await listSpaces(owner.id);
    expect(ownerSpaces.map((entry) => entry.space.id)).toContain(ownerSpace.id);
  });

  it("does not list another user's projects", async () => {
    await expect(listProjectsForSpace(intruder.id, ownerSpace.id)).rejects.toThrow(NotFoundError);
  });

  it("denies the project dashboard to another user", async () => {
    await expect(getProjectDashboard(intruder.id, ownerProject.id)).rejects.toThrow(NotFoundError);
  });

  it("reports progress figures for the owner's own project", async () => {
    const dashboard = await getProjectDashboard(owner.id, ownerProject.id);

    expect(dashboard.project.id).toBe(ownerProject.id);
    expect(dashboard.space.id).toBe(ownerSpace.id);
    expect(dashboard.counts.materials).toBe(0);
    expect(dashboard.counts.concepts).toBe(0);
    // Nothing uploaded yet, so the guidance must ask for material. With no generated
    // recommendation open, the deterministic heuristic is what the dashboard states.
    expect(dashboard.nextAction.source).toBe("heuristic");
    expect(dashboard.nextAction.basis).toBe("Based on your materials");
    expect(dashboard.recommendations).toEqual([]);
    expect(dashboard.activity.length).toBeGreaterThan(0);
  });

  it("keeps the audit trail after a project is deleted", async () => {
    const tempSpace = await createSpace(owner.id, {
      name: `Temp space ${runId}`,
      description: "Holds a project that will be deleted.",
    });

    const tempProject = await createProject(owner.id, {
      spaceId: tempSpace.id,
      name: `Doomed project ${runId}`,
      description: "Will be deleted.",
      goal: "N/A",
    });

    await deleteProject(owner.id, tempProject.id);

    expect(await prisma.project.findUnique({ where: { id: tempProject.id } })).toBeNull();

    // The creation event survives with its project reference nulled (SetNull), so
    // deleting a project cannot rewrite history.
    const surviving = await prisma.activityEvent.findMany({
      where: { userId: owner.id, type: "PROJECT_CREATED" },
    });
    const deletedEvent = await prisma.activityEvent.findFirst({
      where: { userId: owner.id, type: "PROJECT_DELETED" },
    });

    expect(deletedEvent?.projectId).toBeNull();
    expect(deletedEvent?.spaceId).toBe(tempSpace.id);
    expect(deletedEvent?.payload).toMatchObject({ name: tempProject.name });
    expect(surviving.some((event) => payloadName(event.payload) === tempProject.name)).toBe(true);
  });

  it("deletes a space, its projects, and still records the deletion", async () => {
    const space = await createSpace(owner.id, {
      name: `Space to delete ${runId}`,
      description: "Will be deleted.",
    });

    const project = await createProject(owner.id, {
      spaceId: space.id,
      name: `Child project ${runId}`,
      description: "Cascades with the space.",
      goal: "N/A",
    });

    await deleteSpace(owner.id, space.id);

    expect(await prisma.space.findUnique({ where: { id: space.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();

    const deletedEvent = await prisma.activityEvent.findFirst({
      where: { userId: owner.id, type: "SPACE_DELETED" },
    });
    expect(deletedEvent?.payload).toMatchObject({ name: space.name });
  });

  it("keeps space totals consistent with the projects it contains", async () => {
    const dashboard = await getSpaceDashboard(owner.id, ownerSpace.id);

    expect(dashboard.totals.projects).toBe(dashboard.projects.length);
    expect(dashboard.totals.materials).toBe(0);
    expect(dashboard.space.id).toBe(ownerSpace.id);
  });

  /**
   * Regression guard. Home used to derive its empty state from Projects alone, so a
   * user who created a Space — but had no Project yet — kept seeing "Create your
   * first space" and got no feedback that the Space had been created.
   */
  it("surfaces a newly created space on the home dashboard, with no projects yet", async () => {
    const fresh = await prisma.user.create({ data: newUserData("fresh") });

    try {
      const before = await getHomeDashboard(fresh.id);
      expect(before.spaces).toHaveLength(0);
      expect(before.continueLearning).toBeNull();

      const space = await createSpace(fresh.id, {
        name: `Fresh space ${runId}`,
        description: "Created without any projects.",
      });

      const after = await getHomeDashboard(fresh.id);

      expect(after.spaces).toHaveLength(1);
      expect(after.spaces[0]?.space.id).toBe(space.id);
      expect(after.overall.spaces).toBe(1);
      // Still nothing to continue, and no projects — the view distinguishes these.
      expect(after.recentProjects).toHaveLength(0);
      expect(after.continueLearning).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { id: fresh.id } });
    }
  });

  it("does not surface another user's spaces on their home dashboard", async () => {
    const intruderDashboard = await getHomeDashboard(intruder.id);
    const visibleIds = intruderDashboard.spaces.map((entry) => entry.space.id);

    expect(visibleIds).not.toContain(ownerSpace.id);
    expect(intruderDashboard.overall.spaces).toBe(visibleIds.length);
  });
});
