import { describe, expect, it } from "vitest";
import { generateSessionToken, hashToken, safeEqual } from "@/lib/auth/tokens";

describe("generateSessionToken", () => {
  it("produces a URL-safe token", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is long enough to resist brute force", () => {
    // 32 random bytes base64url-encoded.
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is deterministic, so a token can be looked up", () => {
    const token = generateSessionToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("does not store the token itself", () => {
    const token = generateSessionToken();
    const hash = hashToken(token);

    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("separates distinct tokens", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("same-value", "same-value")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(safeEqual("same-value", "other-value")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("short", "considerably-longer-value")).toBe(false);
  });
});
