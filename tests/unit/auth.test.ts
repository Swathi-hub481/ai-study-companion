import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { enforceRateLimit, rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { RateLimitedError } from "@/lib/errors";

describe("password hashing", () => {
  it("never stores the plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    expect(hash).not.toContain("correct-horse-battery-staple");
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("salts, so identical passwords produce different hashes", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);

    expect(first).not.toBe(second);
  });
});

describe("rate limiting", () => {
  it("allows requests up to the limit", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(rateLimit("key-a", 5, 1000, 0).allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 5; attempt += 1) rateLimit("key-b", 5, 1000, 0);

    const blocked = rateLimit("key-b", 5, 1000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("tracks keys independently", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 5; attempt += 1) rateLimit("key-c", 5, 1000, 0);

    expect(rateLimit("key-c", 5, 1000, 0).allowed).toBe(false);
    expect(rateLimit("key-d", 5, 1000, 0).allowed).toBe(true);
  });

  it("resets once the window elapses", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 5; attempt += 1) rateLimit("key-e", 5, 1000, 0);

    expect(rateLimit("key-e", 5, 1000, 0).allowed).toBe(false);
    expect(rateLimit("key-e", 5, 1000, 1001).allowed).toBe(true);
  });

  it("throws a 429-equivalent error when enforcing", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 3; attempt += 1) enforceRateLimit("key-f", 3, 1000);

    expect(() => enforceRateLimit("key-f", 3, 1000)).toThrow(RateLimitedError);
  });
});
