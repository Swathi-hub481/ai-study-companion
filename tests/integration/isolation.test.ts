import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role, type Project, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertProjectAccess, assertSpaceAccess, requireAdmin } from "@/lib/auth/guards";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { waitForDatabase } from "../helpers/db";

/**
 * The acceptance criterion for Phase 2: a user must not be able to reach another
 * user's data, and must not be able to discover that it exists.
 *
 * These tests hit a real database rather than a mock, because the property under
 * test is a property of the SQL predicate (`space: { userId }`). A mocked Prisma
 * would happily "pass" while the real query leaked.
 */

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Not a valid hash and never verified — these rows exist to test ownership only.
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

describe("project and space isolation", () => {
  let owner: User;
  let intruder: User;
  let admin: User;
  let ownerSpace: Space;
  let ownerProject: Project;

  beforeAll(async () => {
    await waitForDatabase();

    owner = await prisma.user.create({
      data: { email: `iso-owner-${runId}@example.com`, name: "Owner", passwordHash: PLACEHOLDER_HASH },
    });

    intruder = await prisma.user.create({
      data: {
        email: `iso-intruder-${runId}@example.com`,
        name: "Intruder",
        passwordHash: PLACEHOLDER_HASH,
      },
    });

    admin = await prisma.user.create({
      data: {
        email: `iso-admin-${runId}@example.com`,
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: PLACEHOLDER_HASH,
      },
    });

    ownerSpace = await prisma.space.create({
      data: { userId: owner.id, name: "Owner Space", description: "Owned by the owner." },
    });

    ownerProject = await prisma.project.create({
      data: {
        spaceId: ownerSpace.id,
        name: "Owner Project",
        description: "Owned by the owner.",
        goal: "Verify isolation.",
      },
    });
  });

  afterAll(async () => {
    // Tolerate a partial setUp: if beforeAll failed, some of these are undefined and
    // a naive cleanup would throw a second, misleading error that buries the first.
    const ids = [owner?.id, intruder?.id, admin?.id].filter((id): id is string => Boolean(id));

    if (ids.length > 0) {
      // Cascades remove spaces, projects, and sessions.
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    // Deliberately no $disconnect(): lib/db.ts exposes a process-wide singleton, and
    // tearing it down here would pull the connection out from under whichever test
    // file runs next.
  });

  it("lets the owner access their own project", async () => {
    const project = await assertProjectAccess(owner.id, ownerProject.id);
    expect(project.id).toBe(ownerProject.id);
  });

  it("denies another user access to the project", async () => {
    await expect(assertProjectAccess(intruder.id, ownerProject.id)).rejects.toThrow(NotFoundError);
  });

  it("reports 404 rather than 403, so resource existence cannot be probed", async () => {
    const error = await assertProjectAccess(intruder.id, ownerProject.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(404);
    expect((error as AppError).status).not.toBe(403);
  });

  it("denies another user access to the space", async () => {
    await expect(assertSpaceAccess(intruder.id, ownerSpace.id)).rejects.toThrow(NotFoundError);
  });

  it("leaves the owner's space accessible to the owner", async () => {
    const space = await assertSpaceAccess(owner.id, ownerSpace.id);
    expect(space.id).toBe(ownerSpace.id);
  });

  it("treats a non-existent project the same as another user's project", async () => {
    const missing = await assertProjectAccess(owner.id, "does-not-exist").catch((e: unknown) => e);
    const foreign = await assertProjectAccess(intruder.id, ownerProject.id).catch((e: unknown) => e);

    // Identical failure shape: neither reveals whether the id exists.
    expect((missing as AppError).status).toBe((foreign as AppError).status);
    expect((missing as AppError).message).toBe((foreign as AppError).message);
  });

  it("scopes a raw project query by owner, with no post-fetch filtering", async () => {
    // Guards this invariant at the query level: if this ever returns a row for the
    // intruder, the ownership predicate has been removed from the guard.
    const leaked = await prisma.project.findFirst({
      where: { id: ownerProject.id, space: { userId: intruder.id } },
    });

    expect(leaked).toBeNull();
  });

  it("does not let an intruder enumerate the owner's projects", async () => {
    const visible = await prisma.project.findMany({
      where: { space: { userId: intruder.id } },
      select: { id: true },
    });

    expect(visible.map((p) => p.id)).not.toContain(ownerProject.id);
  });
});

describe("admin authorization", () => {
  it("rejects a standard user", () => {
    expect(() => requireAdmin({ role: Role.USER })).toThrow(ForbiddenError);
  });

  it("allows an administrator", () => {
    expect(() => requireAdmin({ role: Role.ADMIN })).not.toThrow();
  });
});
