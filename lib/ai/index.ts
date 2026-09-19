import { AiFeature, AiStatus } from "@prisma/client";
import type { ZodType } from "zod";
import { env } from "@/lib/config";
import { AiError } from "@/lib/errors";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import {
  LocalEmbeddingProvider,
  type EmbeddingProvider,
} from "@/lib/ai/providers/local-embeddings";
import { measureUsage, recordAiRequest, type AICallContext } from "@/lib/ai/telemetry";
import type { AIProvider, TextChunk, TextResult, TokenUsage } from "@/lib/ai/types";

/**
 * The single entry point feature modules use to reach a model.
 *
 * Responsibilities kept here, so no feature has to remember them:
 *  - selecting the provider from configuration,
 *  - routing to the model configured for that feature,
 *  - timing the call and recording it as an AiRequest, on success *and* failure,
 *  - refusing embeddings whose dimension does not match the vector column.
 *
 * **Two providers, deliberately.** Generation and embeddings are configured
 * independently (`AI_PROVIDER` / `AI_EMBED_PROVIDER`) because no single one does both:
 * Groq serves models but has no embeddings endpoint, so vectors come from a local model.
 * Feature code does not care — it calls `aiGenerate*` and `aiEmbed`.
 */

let cachedProvider: AIProvider | null = null;
let providerOverride: AIProvider | null = null;

let cachedEmbeddingProvider: EmbeddingProvider | null = null;
let embeddingProviderOverride: EmbeddingProvider | null = null;

/**
 * Bounded, in-memory cache of single-input embeddings.
 *
 * An embedding is a pure function of (provider, model, text): the same text embedded by
 * the same model always produces the same vector, so a cached copy cannot change what
 * retrieval sees. Repeats are real — a learner re-asking a question, or a quiz grading
 * several answers against the same concept — and a hit skips the model call entirely.
 *
 * Deliberately narrow:
 *  - the key carries the provider name *and* the model, so reconfiguring either can
 *    never serve a vector the other produced;
 *  - the text is used verbatim rather than normalised, so a hit means byte-identical
 *    input and there is no way for normalisation to shift semantics;
 *  - only single-input calls are cached. Batch calls are document ingestion, where every
 *    input is unique and caching would only consume memory;
 *  - a hit records no `AiRequest` row, because no model call happened. That is the rule
 *    the rest of this module follows: one row per call, not per request.
 *
 * Nothing project- or user-specific is cached, so a hit cannot leak across tenants —
 * only the vector for a given piece of text under a given model, which is the same for
 * everyone.
 */
const EMBEDDING_CACHE_LIMIT = 256;

const embeddingCache = new Map<string, number[]>();

function readCachedEmbedding(key: string): number[] | undefined {
  const hit = embeddingCache.get(key);
  if (!hit) return undefined;

  // Re-inserting moves the entry to the end of the Map's insertion order, which is what
  // makes eviction below least-recently-*used* rather than least-recently-added.
  embeddingCache.delete(key);
  embeddingCache.set(key, hit);

  return hit;
}

function writeCachedEmbedding(key: string, vector: number[]): void {
  embeddingCache.set(key, vector);

  if (embeddingCache.size <= EMBEDDING_CACHE_LIMIT) return;

  const oldest = embeddingCache.keys().next().value;
  if (oldest !== undefined) embeddingCache.delete(oldest);
}

/** Test seam: drop memoised query vectors. */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export function getAIProvider(): AIProvider {
  if (providerOverride) return providerOverride;

  if (!cachedProvider) {
    switch (env.AI_PROVIDER) {
      case "mock":
        cachedProvider = new MockAIProvider();
        break;
      case "openai":
        cachedProvider = new OpenAIProvider();
        break;
      case "groq":
        // Groq speaks the OpenAI wire protocol, so the same provider serves it with
        // different credentials.
        cachedProvider = new OpenAIProvider({
          name: "groq",
          apiKeyName: "GROQ_API_KEY",
          apiKey: env.GROQ_API_KEY,
          baseURL: env.GROQ_BASE_URL,
        });
        break;
    }
  }

  return cachedProvider;
}

/**
 * The provider that turns text into vectors. Separate from `getAIProvider()`: a
 * generation provider cannot be assumed to embed anything.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProviderOverride) return embeddingProviderOverride;

  if (!cachedEmbeddingProvider) {
    switch (env.AI_EMBED_PROVIDER) {
      case "mock":
        cachedEmbeddingProvider = new MockAIProvider();
        break;
      case "openai":
        cachedEmbeddingProvider = new OpenAIProvider();
        break;
      case "local":
        cachedEmbeddingProvider = new LocalEmbeddingProvider();
        break;
    }
  }

  return cachedEmbeddingProvider;
}

/** Test seam: force a provider (or clear the override). */
export function setAIProviderForTesting(provider: AIProvider | null): void {
  providerOverride = provider;
  cachedProvider = null;
}

/** Test seam: force an embedding provider (or clear the override). */
export function setEmbeddingProviderForTesting(provider: EmbeddingProvider | null): void {
  embeddingProviderOverride = provider;
  cachedEmbeddingProvider = null;
}

/**
 * Per-feature model routing. Extraction runs constantly and can use a cheap model,
 * while tutoring benefits from a stronger one — the split is configuration, not code.
 */
export function modelForFeature(feature: AiFeature): string {
  switch (feature) {
    case AiFeature.TUTOR:
      return env.AI_MODEL_TUTOR;
    case AiFeature.QUIZ_GENERATE:
      return env.AI_MODEL_QUIZ;
    case AiFeature.ANSWER_GRADE:
      return env.AI_MODEL_GRADE;
    case AiFeature.CONCEPT_EXTRACT:
      return env.AI_MODEL_EXTRACT;
    case AiFeature.RECOMMEND:
    case AiFeature.GROWTH_INSIGHT:
      return env.AI_MODEL_RECOMMEND;
    case AiFeature.EVAL:
      // Evaluation grading is judging an artefact against a rubric — the grading model.
      return env.AI_MODEL_GRADE;
    case AiFeature.EMBED:
      return env.AI_EMBED_MODEL;
  }
}

type NamedProvider = { readonly name: string };

/** Runs a model call, recording an AiRequest row whether it succeeds or fails. */
async function measured<T, P extends NamedProvider>(
  provider: P,
  context: AICallContext,
  model: string,
  run: (provider: P) => Promise<{ value: T; usage?: TokenUsage }>,
): Promise<T> {
  const startedAt = Date.now();

  try {
    const { value, usage } = await run(provider);

    await recordAiRequest({
      context,
      provider: provider.name,
      model,
      usage,
      latencyMs: Date.now() - startedAt,
      status: AiStatus.SUCCESS,
    });

    return value;
  } catch (error) {
    // A failed call is as interesting as a slow one, so it is recorded too.
    await recordAiRequest({
      context,
      provider: provider.name,
      model,
      latencyMs: Date.now() - startedAt,
      status: AiStatus.FAILED,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function aiGenerateText(params: {
  context: AICallContext;
  system?: string;
  prompt: string;
  temperature?: number;
}): Promise<TextResult> {
  const provider = getAIProvider();
  const model = modelForFeature(params.context.feature);

  return measured(provider, params.context, model, async (active) => {
    const result = await active.generateText({
      model,
      system: params.system,
      prompt: params.prompt,
      temperature: params.temperature,
    });

    return { value: result, usage: result.usage };
  });
}

export async function aiGenerateStructured<T>(params: {
  context: AICallContext;
  schemaName: string;
  schema: ZodType<T>;
  system?: string;
  prompt: string;
  temperature?: number;
}): Promise<T> {
  const provider = getAIProvider();
  const model = modelForFeature(params.context.feature);

  return measured(provider, params.context, model, async (active) => {
    const result = await active.generateStructured({
      model,
      schemaName: params.schemaName,
      schema: params.schema,
      system: params.system,
      prompt: params.prompt,
      temperature: params.temperature,
    });

    return { value: result.value, usage: result.usage };
  });
}

export async function aiEmbed(params: {
  context: Omit<AICallContext, "feature">;
  inputs: string[];
}): Promise<number[][]> {
  const context: AICallContext = { ...params.context, feature: AiFeature.EMBED };
  const model = modelForFeature(AiFeature.EMBED);
  const provider = getEmbeddingProvider();

  const cacheKey =
    params.inputs.length === 1 ? `${provider.name}\u0000${model}\u0000${params.inputs[0]}` : null;

  if (cacheKey) {
    const cached = readCachedEmbedding(cacheKey);
    if (cached) return [cached];
  }

  const embeddings = await measured(provider, context, model, async (active) => {
    const result = await active.embed({ model, input: params.inputs });

    // The vector column is fixed at a set width. Failing here, loudly, beats
    // writing a malformed vector that only breaks at query time.
    const wrongWidth = result.embeddings.find(
      (vector) => vector.length !== env.AI_EMBED_DIMENSIONS,
    );

    if (wrongWidth) {
      throw new AiError(
        `Embedding model "${model}" returned ${wrongWidth.length} dimensions, but the vector store expects ${env.AI_EMBED_DIMENSIONS}. ` +
          `Align AI_EMBED_DIMENSIONS with the model (or migrate the column) before continuing.`,
      );
    }

    return { value: result.embeddings, usage: result.usage };
  });

  // Only a validated, correctly-sized vector is memoised.
  if (cacheKey && embeddings[0]) {
    writeCachedEmbedding(cacheKey, embeddings[0]);
  }

  return embeddings;
}

/**
 * Streaming variant. Telemetry is recorded in a `finally` so the row exists even if
 * the consumer disconnects mid-stream — an aborted request is still worth knowing about.
 */
export async function* aiStreamText(params: {
  context: AICallContext;
  system?: string;
  prompt: string;
  temperature?: number;
}): AsyncGenerator<TextChunk, void, undefined> {
  const model = modelForFeature(params.context.feature);
  const provider = getAIProvider();
  const startedAt = Date.now();

  let completion = "";
  let status: AiStatus = AiStatus.SUCCESS;
  let errorMessage: string | undefined;

  try {
    for await (const chunk of provider.streamText({
      model,
      system: params.system,
      prompt: params.prompt,
      temperature: params.temperature,
    })) {
      completion += chunk.delta;
      yield chunk;
    }
  } catch (error) {
    status = AiStatus.FAILED;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await recordAiRequest({
      context: params.context,
      provider: provider.name,
      model,
      usage: measureUsage(params.prompt, completion),
      latencyMs: Date.now() - startedAt,
      status,
      error: errorMessage,
    });
  }
}

export { PROMPT_VERSIONS } from "@/lib/ai/prompts";
export { SCHEMA_NAMES } from "@/lib/ai/schemas";
export { summarizeAiUsage, type AICallContext } from "@/lib/ai/telemetry";
export type { AIProvider, TextChunk, TokenUsage } from "@/lib/ai/types";
export type { EmbeddingProvider } from "@/lib/ai/providers/local-embeddings";
