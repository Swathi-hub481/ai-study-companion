import { RateLimitedError } from "@/lib/errors";

/**
 * Fixed-window rate limiter.
 *
 * Deliberately in-process: this is a prototype and adding Redis would mean a
 * second stateful dependency for a small amount of protection. The consequence is
 * that limits apply per server instance, so a multi-instance deployment gets a
 * proportionally higher effective limit. Swapping in a Redis-backed counter behind
 * this same signature is the intended upgrade.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Guards against unbounded memory growth from a flood of unique keys. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);

    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  existing.count += 1;

  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Applies a limit and throws 429 when it is exceeded. */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "Too many attempts. Please wait a moment and try again.",
): void {
  const result = rateLimit(key, limit, windowMs);

  if (!result.allowed) {
    throw new RateLimitedError(message);
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
  message: string;
};

/**
 * Every budget, in one table.
 *
 * Scattered literals are how a limit gets forgotten: the quiz routes — which spend real
 * money per request — went several phases without one. Collected here, the policy is
 * reviewable in a single place and testable without going through a route.
 */
export const RATE_LIMITS = {
  loginPerIp: {
    limit: 20,
    windowMs: 60_000,
    message: "Too many sign-in attempts. Please wait a minute.",
  },
  loginPerAccount: {
    limit: 8,
    windowMs: 60_000,
    message: "Too many sign-in attempts for this account. Please wait a minute.",
  },
  registerPerIp: {
    limit: 5,
    windowMs: 60_000,
    message: "Too many sign-ups from this address.",
  },
  materialUpload: {
    limit: 20,
    windowMs: 60_000,
    message: "Too many uploads. Please wait a minute.",
  },
  tutor: {
    limit: 20,
    windowMs: 60_000,
    message: "You're asking questions very quickly. Please wait a moment.",
  },
  /** Each question is a model call, so starting a quiz generates spend. */
  quizStart: {
    limit: 10,
    windowMs: 60_000,
    message: "You're starting quizzes very quickly. Please wait a minute.",
  },
  /** Submitting an answer grades it; open-ended answers are a model call. */
  quizAnswer: {
    limit: 40,
    windowMs: 60_000,
    message: "You're answering very quickly. Please wait a minute.",
  },
  quizComplete: {
    limit: 10,
    windowMs: 60_000,
    message: "You're finishing quizzes very quickly. Please wait a minute.",
  },
  /** Queues two model-backed jobs per call. */
  recommendationsRefresh: {
    limit: 5,
    windowMs: 60_000,
    message: "You've asked for new suggestions several times. Please wait a minute.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

/** Applies a named policy to a key. */
export function enforcePolicy(key: string, policy: RateLimitPolicy): void {
  enforceRateLimit(key, policy.limit, policy.windowMs, policy.message);
}
