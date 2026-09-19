import { PrismaClient } from "@prisma/client";
import { isProduction } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Prisma singleton.
 *
 * Next.js hot-reloads server modules in development, which would otherwise create a
 * new connection pool on every edit and exhaust Postgres connections. Caching the
 * instance on `globalThis` keeps one pool per process.
 *
 * Used by the API layer, the background worker, and CLI scripts alike.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Error codes that mean the statement never reached the server, and so are safe to
 * retry without risking a duplicate write:
 *
 *   P1001 — the database server could not be reached
 *   P1002 — the server was reached but the connection timed out
 *
 * Deliberately excludes P1017 ("server has closed the connection"), which can occur
 * *after* a statement has been accepted, where a blind retry could repeat a write.
 */
const RETRYABLE_CONNECTION_CODES = new Set(["P1001", "P1002"]);

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_CONNECTION_CODES.has(code);
}

/**
 * Adds a bounded retry for transient connection failures.
 *
 * Managed Postgres and pooled proxies occasionally refuse or drop a connection. That
 * is a transport problem, not an application error, and surfacing it to the user as a
 * failed request would be needlessly brittle.
 */
function buildClient(): PrismaClient {
  const base = new PrismaClient({
    log: isProduction() ? ["error"] : ["warn", "error"],
  });

  const extended = base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          try {
            return await query(args);
          } catch (error) {
            if (!isRetryable(error)) throw error;

            lastError = error;

            if (attempt < MAX_ATTEMPTS) {
              logger.warn(
                { attempt, maxAttempts: MAX_ATTEMPTS },
                "Transient database connection failure; retrying",
              );
              await sleep(BASE_DELAY_MS * attempt);
            }
          }
        }

        throw lastError;
      },
    },
  });

  // The extension alters query behaviour only; it does not change the client's API
  // surface. Prisma's extended-client type is structurally incompatible with
  // PrismaClient, so the cast keeps every consumer typed against the plain client.
  // If a future extension *reshapes* results, this cast must be revisited.
  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? buildClient();

if (!isProduction()) {
  globalForPrisma.prisma = prisma;
}

/** Validates connectivity — used by the health check and the worker startup. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
