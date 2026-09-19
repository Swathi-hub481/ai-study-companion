/**
 * Background worker entry point.
 *
 * Runs as a separate process from the web server, because long-running work must not
 * be tied to a request's lifetime — the user should be able to close the browser and
 * still find their material processed.
 *
 * Usage: npm run worker
 */

import { assertConfig } from "../lib/config";
import { checkDatabaseConnection, prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { runWorkerLoop } from "../lib/jobs/worker";
import { countJobsByStatus } from "../lib/jobs/queue";

async function main() {
  assertConfig();

  if (!(await checkDatabaseConnection())) {
    logger.error("Cannot reach the database. Is the container running? (npm run db:up)");
    process.exitCode = 1;
    return;
  }

  logger.info({ jobs: await countJobsByStatus() }, "Queue state at startup");

  const controller = new AbortController();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info({ signal }, "Shutting down worker");
      controller.abort();
    });
  }

  try {
    await runWorkerLoop(controller.signal);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  logger.error({ err: error }, "Worker crashed");
  await prisma.$disconnect();
  process.exitCode = 1;
});
