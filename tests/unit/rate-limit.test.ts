import { afterEach, describe, expect, it } from "vitest";
import { RATE_LIMITS, enforcePolicy, resetRateLimits, type RateLimitPolicy } from "@/lib/rate-limit";

/**
 * The policy table, and the guarantee that it is what protects the expensive endpoints.
 *
 * The mechanics of the limiter are covered in `auth.test.ts`; this file is about the
 * *budgets* — that every endpoint which spends money has one, and that they behave.
 */
describe("rate-limit policies", () => {
  afterEach(() => {
    resetRateLimits();
  });

  it("declares a budget for every model-billing or upload endpoint", () => {
    // Named explicitly so adding an expensive route without a limit is a visible omission
    // here rather than an invisible one in production.
    expect(Object.keys(RATE_LIMITS)).toEqual(
      expect.arrayContaining([
        "loginPerIp",
        "loginPerAccount",
        "registerPerIp",
        "materialUpload",
        "tutor",
        "quizStart",
        "quizAnswer",
        "quizComplete",
        "recommendationsRefresh",
      ]),
    );
  });

  it("keeps every budget positive, bounded, and explained", () => {
    for (const [name, policy] of Object.entries(RATE_LIMITS)) {
      expect(policy.limit, `${name} limit`).toBeGreaterThan(0);
      expect(policy.windowMs, `${name} window`).toBeGreaterThan(0);
      // A limit that fires without telling the user what happened is a bug report waiting.
      expect(policy.message.length, `${name} message`).toBeGreaterThan(10);
    }
  });

  it("allows exactly the limit and refuses the next request", () => {
    const policy: RateLimitPolicy = { limit: 3, windowMs: 60_000, message: "Slow down." };

    expect(() => {
      enforcePolicy("device-a", policy);
      enforcePolicy("device-a", policy);
      enforcePolicy("device-a", policy);
    }).not.toThrow();

    expect(() => enforcePolicy("device-a", policy)).toThrow("Slow down.");
  });

  it("counts each key separately, so one user cannot exhaust another's budget", () => {
    const policy = RATE_LIMITS.quizStart;

    for (let index = 0; index < policy.limit; index += 1) {
      enforcePolicy("user-a", policy);
    }

    expect(() => enforcePolicy("user-a", policy)).toThrow();
    expect(() => enforcePolicy("user-b", policy)).not.toThrow();
  });

  it("keeps the per-account sign-in limit tighter than the per-address one", () => {
    // The per-account limit is what resists credential stuffing against one account; if it
    // ever became the looser of the two it would stop doing that job.
    expect(RATE_LIMITS.loginPerAccount.limit).toBeLessThan(RATE_LIMITS.loginPerIp.limit);
  });

  it("leaves interactive answering roomier than quiz generation", () => {
    // Generating a quiz is several model calls; grading one answer is one.
    expect(RATE_LIMITS.quizAnswer.limit).toBeGreaterThan(RATE_LIMITS.quizStart.limit);
  });
});
