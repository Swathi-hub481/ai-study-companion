import { describe, expect, it } from "vitest";
import { JobType } from "@prisma/client";
import { getHandler, registeredJobTypes } from "@/lib/jobs/handlers";

/**
 * The registry's contract: a job type without a handler must fail loudly, because a job
 * that silently does nothing is far harder to notice than one that lands in the dead-letter
 * queue.
 *
 * Deliberately uses a made-up type rather than a real-but-unimplemented one: this assertion
 * has already been invalidated twice by later phases registering the type a test happened
 * to pick.
 */
describe("job handler registry", () => {
  it("throws for a type that has no handler", () => {
    expect(() => getHandler("NOT_A_REAL_JOB_TYPE" as JobType)).toThrow(/No handler is registered/);
  });

  it("returns a handler for every type it advertises", () => {
    const types = registeredJobTypes();

    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      expect(typeof getHandler(type)).toBe("function");
    }
  });
});
