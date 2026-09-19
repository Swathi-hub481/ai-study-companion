import pino, { type Logger } from "pino";
import { env, isProduction } from "@/lib/config";

/**
 * Structured logging. One logger for the Next.js server, the background worker,
 * and CLI scripts, so job/AI failures are greppable in a single format.
 *
 * Pretty output is used outside production only; production emits JSON for log
 * aggregation.
 */
function createLogger(): Logger {
  const level = env.LOG_LEVEL;

  if (isProduction()) {
    return pino({ level, base: { service: "ai-study-companion" } });
  }

  return pino({
    level,
    base: { service: "ai-study-companion" },
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service",
        messageFormat: "{msg}",
      },
    },
  });
}

export const logger = createLogger();

/** Creates a namespaced child logger, e.g. `logger.child({ job: "material.process" })`. */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

export type { Logger };
