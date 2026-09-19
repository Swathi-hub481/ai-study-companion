import { prisma } from "@/lib/db";

/**
 * Waits until the database accepts a query.
 *
 * Integration tests assert application behaviour, not infrastructure readiness.
 * Docker Desktop's port forwarding on Windows intermittently refuses the first
 * connection after an idle period, surfacing as Prisma P1001 even though the
 * container reports healthy. Waiting for the dependency removes that flake without
 * hiding a genuine outage — if the database never answers, this still fails, and
 * says so clearly.
 */
export async function waitForDatabase(
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 15;
  const delayMs = options.delayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Database was not reachable after ${attempts} attempts. ` +
      `Is the container running (npm run db:up) and migrated (npm run db:test:setup)?\n` +
      `Last error: ${lastError instanceof Error ? lastError.message.split("\n")[0] : String(lastError)}`,
  );
}
