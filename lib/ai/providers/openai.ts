import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/config";
import { AiError, AiInvalidOutputError } from "@/lib/errors";
import type {
  AIProvider,
  EmbedRequest,
  EmbedResult,
  StructuredRequest,
  StructuredResult,
  TextChunk,
  TextRequest,
  TextResult,
  TokenUsage,
} from "@/lib/ai/types";

/**
 * OpenAI-compatible provider.
 *
 * Two deliberate choices:
 *  - The client is constructed lazily, so an unconfigured deployment fails only when
 *    a feature actually needs a model, with a message that names the missing variable.
 *  - Structured output is validated locally against the caller's Zod schema *after*
 *    the provider has enforced it. Provider-side enforcement is a request, not a
 *    guarantee; nothing reaches the database unvalidated.
 *
 * Although named for OpenAI, this provider is constructed from options rather than
 * reading configuration directly, so the same implementation serves any endpoint that
 * speaks the OpenAI wire protocol — Groq, for instance. Only the credentials and base
 * URL differ.
 */

export type OpenAICompatibleOptions = {
  /** Label recorded on AiRequest rows. */
  name?: string;
  /** Environment variable holding the key, named in the error when it is missing. */
  apiKeyName?: string;
  apiKey?: string;
  baseURL?: string;
};

function usageFrom(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): TokenUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    estimated: false,
  };
}

function messagesFor(request: TextRequest) {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  messages.push({ role: "user", content: request.prompt });
  return messages;
}

export class OpenAIProvider implements AIProvider {
  readonly name: string;

  private readonly apiKeyName: string;
  private readonly apiKey: string;
  private readonly baseURL: string | undefined;
  private client: OpenAI | null = null;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.name = options.name ?? "openai";
    this.apiKeyName = options.apiKeyName ?? "OPENAI_API_KEY";
    this.apiKey = options.apiKey ?? env.OPENAI_API_KEY ?? "";
    this.baseURL = options.baseURL ?? (env.OPENAI_BASE_URL || undefined);
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;

    if (!this.apiKey) {
      throw new AiError(
        `${this.apiKeyName} is not set. Set it in the environment, or use AI_PROVIDER=mock to run without a model.`,
      );
    }

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: env.AI_REQUEST_TIMEOUT_MS,
      // The SDK retries transient failures (429, 5xx, connection resets). Retrying
      // is safe here because these calls do not mutate application state.
      maxRetries: 2,
    });

    return this.client;
  }

  async generateText(request: TextRequest): Promise<TextResult> {
    const client = this.getClient();

    const response = await client.chat.completions.create({
      model: request.model,
      messages: messagesFor(request),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    });

    const text = response.choices[0]?.message?.content ?? "";

    if (!text) {
      throw new AiError("The model returned an empty response.");
    }

    return { text, usage: usageFrom(response.usage) };
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const client = this.getClient();

    const response = await client.chat.completions.create({
      model: request.model,
      messages: messagesFor(request),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      // Constrains decoding to the JSON schema derived from the Zod schema.
      response_format: zodResponseFormat(request.schema, request.schemaName),
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new AiError("The model returned an empty structured response.");
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(content);
    } catch (error) {
      throw new AiInvalidOutputError("The model returned content that was not valid JSON.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const value = request.schema.parse(parsedJson);
      return { value, usage: usageFrom(response.usage) };
    } catch (error) {
      // Surfaced rather than repaired: a partially-trusted object must never be
      // persisted or used to change application state.
      throw new AiInvalidOutputError(
        `The model returned JSON that failed schema validation for "${request.schemaName}".`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const client = this.getClient();

    // Only the v3 embedding models accept an explicit output dimension.
    const supportsDimensions = request.model.startsWith("text-embedding-3");

    const response = await client.embeddings.create({
      model: request.model,
      input: request.input,
      ...(supportsDimensions ? { dimensions: env.AI_EMBED_DIMENSIONS } : {}),
    });

    const embeddings = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    return {
      embeddings,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: 0,
        estimated: false,
      },
    };
  }

  async *streamText(request: TextRequest): AsyncGenerator<TextChunk, void, undefined> {
    const client = this.getClient();

    const stream = await client.chat.completions.create({
      model: request.model,
      messages: messagesFor(request),
      stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    });

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) yield { delta };
    }
  }
}
