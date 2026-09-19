import { afterEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "@/lib/config";
import {
  getAIProvider,
  getEmbeddingProvider,
  setAIProviderForTesting,
  setEmbeddingProviderForTesting,
} from "@/lib/ai";

/**
 * Generation and embeddings are configured independently, because no single provider
 * serves both roles: Groq has models but no embeddings API. These tests pin that
 * changing one axis never silently changes the other.
 */

const original = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_EMBED_PROVIDER: process.env.AI_EMBED_PROVIDER,
};

function restore(key: keyof typeof original): void {
  const value = original[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("AI provider selection", () => {
  afterEach(() => {
    restore("AI_PROVIDER");
    restore("AI_EMBED_PROVIDER");
    resetConfigCache();
    setAIProviderForTesting(null);
    setEmbeddingProviderForTesting(null);
  });

  it("uses the deterministic mock providers under test", () => {
    expect(getAIProvider().name).toBe("mock");
    expect(getEmbeddingProvider().name).toBe("mock");
  });

  it("selects the Groq provider for generation", () => {
    process.env.AI_PROVIDER = "groq";
    resetConfigCache();

    // Construction does not require a key; only an actual call does.
    expect(getAIProvider().name).toBe("groq");
  });

  it("selects the local embedding provider without loading the model", () => {
    process.env.AI_EMBED_PROVIDER = "local";
    resetConfigCache();

    // Selecting the provider must not pull in the ONNX runtime — that happens lazily,
    // on the first embed.
    expect(getEmbeddingProvider().name).toBe("local");
  });

  it("keeps generation and embedding selection independent", () => {
    process.env.AI_PROVIDER = "groq";
    process.env.AI_EMBED_PROVIDER = "local";
    resetConfigCache();

    expect(getAIProvider().name).toBe("groq");
    expect(getEmbeddingProvider().name).toBe("local");
  });
});
