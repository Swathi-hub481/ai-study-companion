import type { ZodType } from "zod";

/**
 * The AI provider contract.
 *
 * Everything that talks to a model goes through this interface, so swapping
 * providers, pinning a cheaper model per feature, or running the whole app offline
 * against the deterministic mock requires no change to feature code.
 */

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  /** True when the count was derived locally because the provider did not report it. */
  estimated: boolean;
};

export type TextRequest = {
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type TextResult = {
  text: string;
  usage: TokenUsage;
};

export type StructuredRequest<T> = TextRequest & {
  /** Used for provider-side schema enforcement and to key mock responses. */
  schemaName: string;
  schema: ZodType<T>;
};

export type StructuredResult<T> = {
  value: T;
  usage: TokenUsage;
};

export type EmbedRequest = {
  model: string;
  input: string[];
};

export type EmbedResult = {
  embeddings: number[][];
  usage: TokenUsage;
};

export type TextChunk = {
  delta: string;
};

export interface AIProvider {
  readonly name: string;
  generateText(request: TextRequest): Promise<TextResult>;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  streamText(request: TextRequest): AsyncGenerator<TextChunk, void, undefined>;
}
