import { Role, type Material, type Project, type Quiz, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * Authorization guards.
 *
 * Two rules make project-level isolation hold:
 *
 *  1. Ownership is enforced *inside* the query (`space: { userId }`), never by
 *     fetching a row and comparing afterwards. A post-fetch check can be forgotten;
 *     a query that cannot return another user's row cannot leak it.
 *
 *  2. A resource that exists but belongs to someone else raises NotFound, not
 *     Forbidden. Returning 403 would confirm that the id exists, letting a caller
 *     enumerate other users' Projects and Spaces.
 *
 * Deliberately free of request/framework imports so it can be unit- and
 * integration-tested directly, and reused by the background worker (which has no
 * HTTP request but must still enforce ownership).
 */

export function requireAdmin(user: Pick<User, "role">): void {
  if (user.role !== Role.ADMIN) {
    throw new ForbiddenError("Administrator access is required.");
  }
}

/** Returns the Project only if it belongs to `userId`. */
export async function assertProjectAccess(userId: string, projectId: string): Promise<Project> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      space: { userId },
    },
  });

  if (!project) {
    throw new NotFoundError("Project");
  }

  return project;
}

/** Returns the Space only if it belongs to `userId`. */
export async function assertSpaceAccess(userId: string, spaceId: string): Promise<Space> {
  const space = await prisma.space.findFirst({
    where: { id: spaceId, userId },
  });

  if (!space) {
    throw new NotFoundError("Space");
  }

  return space;
}

/**
 * Resolves the owning user id for a Project, for use by background jobs. Jobs
 * carry only a projectId, so they must re-derive ownership rather than trusting
 * a payload.
 */
export async function resolveProjectOwnerId(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { space: { select: { userId: true } } },
  });

  return project?.space.userId ?? null;
}

/** Returns the Material only if it belongs to `userId`. */
export async function assertMaterialAccess(
  userId: string,
  materialId: string,
): Promise<Material> {
  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      project: { space: { userId } },
    },
  });

  if (!material) {
    throw new NotFoundError("Material");
  }

  return material;
}

/** Returns the Quiz only if it belongs to `userId`, via its Project's Space. */
export async function assertQuizAccess(userId: string, quizId: string): Promise<Quiz> {
  const quiz = await prisma.quiz.findFirst({
    where: {
      id: quizId,
      project: { space: { userId } },
    },
  });

  if (!quiz) {
    throw new NotFoundError("Quiz");
  }

  return quiz;
}
