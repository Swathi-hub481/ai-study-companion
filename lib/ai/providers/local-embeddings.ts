import { env } from "@/lib/config";
import { AiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/ai/telemetry";
import type { EmbedRequest, EmbedResult } from "@/lib/ai/types";

/**
 * Local, in-process embeddings.
 *
 * Retrieval needs a vector for every query, and Groq does not offer an embeddings API
 * at all. Running a small sentence-transformer through ONNX Runtime removes the
 * dependency on any embedding vendor: no key, no per-query cost, no network after the
 * model has been downloaded once.
 *
 * The trade-off is a one-time model download and a model that is smaller (and so less
 * nuanced) than a hosted one. Swapping `AI_EMBED_MODEL` for a different model changes
 * the vector width, which requires a migration and re-embedding — see
 * `scripts/reembed-materials.ts`.
 */

/** Narrow contract: an embedding provider only ever embeds. */
export type EmbeddingProvider = {
  readonly name: string;
  embed(request: EmbedRequest): Promise<EmbedResult>;
};

type FeatureExtractor = (
  input: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";

  private extractor: Promise<FeatureExtractor> | null = null;

  /**
   * Loaded lazily and memoised: the library pulls a native ONNX runtime and the model
   * is fetched on first use, neither of which should be paid for by a deployment that
   * never embeds anything.
   */
  private getExtractor(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;

    this.extractor = (async () => {
      const { pipeline } = await import("@huggingface/transformers");

      logger.info(
        { model: env.AI_EMBED_MODEL },
        "Loading the local embedding model (the first run downloads it)",
      );

      const pipe = await pipeline("feature-extraction", env.AI_EMBED_MODEL);

      return pipe as unknown as FeatureExtractor;
    })();

    return this.extractor;
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const estimatedUsage = (inputs: string[]): EmbedResult["usage"] => ({
      promptTokens: inputs.reduce((total, text) => total + estimateTokens(text), 0),
      completionTokens: 0,
      estimated: true,
    });

    if (request.input.length === 0) {
      return { embeddings: [], usage: estimatedUsage([]) };
    }

    let extractor: FeatureExtractor;

    try {
      extractor = await this.getExtractor();
    } catch (error) {
      // A failed load is almost always a network or cache problem, not a code fault —
      // say so, rather than surfacing an opaque ONNX error.
      throw new AiError(
        `Could not load the local embedding model "${env.AI_EMBED_MODEL}". ` +
          "It is downloaded on first use, so check network access and the model cache.",
        { cause: error },
      );
    }

    // Mean pooling over tokens, then L2 normalisation, is what makes cosine distance
    // meaningful for these vectors.
    const output = await extractor(request.input, { pooling: "mean", normalize: true });

    return { embeddings: output.tolist(), usage: estimatedUsage(request.input) };
  }
}
