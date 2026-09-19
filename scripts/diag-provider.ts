/**
 * Minimal provider probe.
 *
 * Answers one question without guessing: can the configured providers actually complete
 * an embedding call and a text/streaming call right now? It prints the exact error when
 * they cannot. Secrets are never printed — only whether a key is present.
 *
 * Usage: npx tsx scripts/diag-provider.ts
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

/** Strips anything that could resemble a credential from a message before printing. */
function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

function describe(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      name?: string;
      status?: number;
      code?: string;
      type?: string;
      message?: string;
    };
    return [
      `name=${candidate.name ?? "?"}`,
      `status=${candidate.status ?? "?"}`,
      `type=${candidate.type ?? "?"}`,
      `code=${candidate.code ?? "?"}`,
      `message=${redact(candidate.message ?? "")}`,
    ].join(" | ");
  }

  return redact(String(error));
}

async function main() {
  const { env } = await import("../lib/config");
  const { getAIProvider, getEmbeddingProvider } = await import("../lib/ai");

  console.log("=== config (no secrets) ===");
  console.log("AI_PROVIDER          :", env.AI_PROVIDER);
  console.log("AI_EMBED_PROVIDER    :", env.AI_EMBED_PROVIDER);
  console.log("AI_MODEL_TUTOR       :", env.AI_MODEL_TUTOR);
  console.log("AI_MODEL_EXTRACT     :", env.AI_MODEL_EXTRACT);
  console.log("AI_EMBED_MODEL       :", env.AI_EMBED_MODEL);
  console.log("AI_EMBED_DIMENSIONS  :", env.AI_EMBED_DIMENSIONS);
  console.log("GROQ_API_KEY         :", env.GROQ_API_KEY ? "present (non-empty)" : "MISSING");
  console.log("OPENAI_API_KEY       :", env.OPENAI_API_KEY ? "present (non-empty)" : "not set");
  console.log("generation provider  :", getAIProvider().name);
  console.log("embedding provider   :", getEmbeddingProvider().name);

  const generation = getAIProvider();
  const embedding = getEmbeddingProvider();

  console.log("\n=== embedding call (AI_EMBED_MODEL) ===");
  try {
    const started = Date.now();
    const result = await embedding.embed({ model: env.AI_EMBED_MODEL, input: ["ping"] });
    const dims = result.embeddings[0]?.length;
    const matches = dims === env.AI_EMBED_DIMENSIONS;
    console.log(
      `SUCCESS dims=${dims} expected=${env.AI_EMBED_DIMENSIONS} match=${matches} ${Date.now() - started}ms`,
    );
  } catch (error) {
    console.log("FAILED  :", describe(error));
  }

  console.log("\n=== streaming call (AI_MODEL_TUTOR) ===");
  try {
    const started = Date.now();
    let text = "";
    for await (const chunk of generation.streamText({
      model: env.AI_MODEL_TUTOR,
      system: "Reply with one short sentence.",
      prompt: "Say hello.",
    })) {
      text += chunk.delta;
    }
    console.log(
      `SUCCESS chars=${text.length} ${Date.now() - started}ms sample=${redact(text.slice(0, 80))}`,
    );
  } catch (error) {
    console.log("FAILED  :", describe(error));
  }

  console.log("\n=== non-streaming call (AI_MODEL_TUTOR) ===");
  try {
    const started = Date.now();
    const result = await generation.generateText({
      model: env.AI_MODEL_TUTOR,
      prompt: "Say hello in three words.",
    });
    console.log(`SUCCESS chars=${result.text.length} ${Date.now() - started}ms`);
  } catch (error) {
    console.log("FAILED  :", describe(error));
  }
}

main().catch((error) => {
  console.error(describe(error));
  process.exitCode = 1;
});
