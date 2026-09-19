import { afterEach, describe, expect, it } from "vitest";
import { env, resetConfigCache } from "@/lib/config";

/**
 * Config is validated once and memoised, so every case must clear the cache to
 * observe a change in the environment.
 */
describe("config", () => {
  afterEach(() => {
    resetConfigCache();
  });

  it("exposes the AI provider selected by the environment", () => {
    expect(["mock", "openai", "groq"]).toContain(env.AI_PROVIDER);
  });

  it("keeps generation and embedding providers independent", () => {
    // No provider does both: Groq serves models but has no embeddings API.
    expect(["mock", "openai", "groq"]).toContain(env.AI_PROVIDER);
    expect(["mock", "openai", "local"]).toContain(env.AI_EMBED_PROVIDER);
  });

  it("coerces numeric values rather than leaving them as strings", () => {
    expect(typeof env.RETRIEVAL_TOP_K).toBe("number");
    expect(typeof env.MAX_UPLOAD_MB).toBe("number");
    expect(env.RETRIEVAL_TOP_K).toBeGreaterThan(0);
  });

  it("coerces boolean-ish values", () => {
    expect(typeof env.OCR_ENABLED).toBe("boolean");
  });

  it("keeps retrieval thresholds inside a sane range", () => {
    expect(env.RETRIEVAL_MIN_SCORE).toBeGreaterThanOrEqual(0);
    expect(env.RETRIEVAL_MIN_SCORE).toBeLessThanOrEqual(1);
  });

  it("rejects a weak AUTH_SECRET instead of silently accepting it", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "too-short";
    resetConfigCache();

    expect(() => env.AUTH_SECRET).toThrow(/AUTH_SECRET/);

    process.env.AUTH_SECRET = original;
    resetConfigCache();
  });

  it("reports a clear error when a required variable is missing", () => {
    const original = process.env.DATABASE_URL;
    // An empty string is treated as unset, which is how a blank `.env` line behaves.
    process.env.DATABASE_URL = "";
    resetConfigCache();

    expect(() => env.DATABASE_URL).toThrow(/DATABASE_URL/);

    process.env.DATABASE_URL = original;
    resetConfigCache();
  });
});
