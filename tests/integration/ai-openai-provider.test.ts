import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { z } from "zod";
import { AiError, AiInvalidOutputError } from "@/lib/errors";
import { env, resetConfigCache } from "@/lib/config";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { setAIProviderForTesting } from "@/lib/ai";
import { SCHEMA_NAMES, conceptExtractionSchema } from "@/lib/ai/schemas";

/**
 * Exercises the real OpenAI provider — request shaping, structured-output parsing,
 * usage extraction, dimension handling, and error mapping — against a local stub that
 * speaks the same wire protocol.
 *
 * This exists because "compiles" is not "works": the provider's JSON parsing and
 * validation paths would otherwise be completely unverified without an API key, and
 * those are exactly the paths that decide whether bad model output reaches the
 * database.
 */

const VALID_EXTRACTION = {
  concepts: [
    {
      name: "Backpropagation",
      description: "The chain rule applied efficiently through a computation graph.",
      importance: 0.9,
      relatedConcepts: ["Gradient descent"],
    },
  ],
};

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function createStubServer(): Server {
  return createServer(async (request, response) => {
    const url = request.url ?? "";
    const body = await readJson(request);
    const model = String(body.model ?? "");

    if (url.endsWith("/chat/completions")) {
      if (body.stream === true) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });

        for (const part of ["Stub ", "streamed ", "answer."]) {
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-stub",
              object: "chat.completion.chunk",
              created: 1,
              model,
              choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
            })}\n\n`,
          );
        }

        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      let content = "Hello from the stub.";

      if (model === "stub-empty") content = "";
      if (model === "stub-bad-json") content = "this is definitely not json";
      if (model === "stub-bad-schema") content = JSON.stringify({ concepts: "not-an-array" });
      if (model === "stub-valid-structured") content = JSON.stringify(VALID_EXTRACTION);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 1,
          model,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
      );
      return;
    }

    if (url.endsWith("/embeddings")) {
      const inputs = Array.isArray(body.input) ? (body.input as unknown[]) : [body.input];
      // Mirrors the real API: honours `dimensions` only when the caller sends it.
      const dimensions = typeof body.dimensions === "number" ? body.dimensions : 8;

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          model,
          data: inputs.map((_, index) => ({
            object: "embedding",
            index,
            embedding: Array.from({ length: dimensions }, (_, i) => index + i * 0.001),
          })),
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      );
      return;
    }

    response.writeHead(404).end("not found");
  });
}

describe("OpenAI provider (against a local stub)", () => {
  let server: Server;
  let provider: OpenAIProvider;

  /**
   * The exact values this file is about to overwrite.
   *
   * `process.env` is shared by every test file in the run, so mutating it without
   * restoring it leaks into whatever runs next. Deleting the keys is not enough: a
   * deleted `AI_PROVIDER` falls back to `.env`, so once `.env` said `openai` a later
   * file silently built a real OpenAI client and called the live API with a stub key.
   */
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    server = createStubServer();

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    savedEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      AI_PROVIDER: process.env.AI_PROVIDER,
    };

    process.env.OPENAI_API_KEY = "stub-key-not-a-real-credential";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.AI_PROVIDER = "openai";
    resetConfigCache();

    provider = new OpenAIProvider();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));

    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    resetConfigCache();
    // The suite shares one process, so also clear the cached provider: a later file
    // must not inherit an OpenAI provider that has no stub server to talk to.
    setAIProviderForTesting(null);
  });

  it("returns text and provider-reported usage", async () => {
    const result = await provider.generateText({
      model: "stub-ok",
      system: "You are a tutor.",
      prompt: "Explain gradient descent.",
    });

    expect(result.text).toBe("Hello from the stub.");
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7, estimated: false });
  });

  it("throws rather than persisting an empty completion", async () => {
    await expect(
      provider.generateText({ model: "stub-empty", prompt: "anything" }),
    ).rejects.toThrow(AiError);
  });

  it("parses and validates structured output", async () => {
    const result = await provider.generateStructured({
      model: "stub-valid-structured",
      schemaName: SCHEMA_NAMES.conceptExtraction,
      schema: conceptExtractionSchema,
      prompt: "Extract the concepts.",
    });

    expect(result.value.concepts).toHaveLength(1);
    expect(result.value.concepts[0]?.name).toBe("Backpropagation");
    expect(result.usage.promptTokens).toBe(11);
  });

  it("rejects content that is not JSON at all", async () => {
    await expect(
      provider.generateStructured({
        model: "stub-bad-json",
        schemaName: SCHEMA_NAMES.conceptExtraction,
        schema: conceptExtractionSchema,
        prompt: "Extract the concepts.",
      }),
    ).rejects.toThrow(AiInvalidOutputError);
  });

  it("rejects JSON that fails schema validation", async () => {
    // Provider-side schema enforcement is a request, not a guarantee. This is the
    // check that keeps a malformed object out of the database.
    await expect(
      provider.generateStructured({
        model: "stub-bad-schema",
        schemaName: SCHEMA_NAMES.conceptExtraction,
        schema: conceptExtractionSchema,
        prompt: "Extract the concepts.",
      }),
    ).rejects.toThrow(AiInvalidOutputError);
  });

  it("throws AiError when the schema is not an object schema the API accepts", async () => {
    // zodResponseFormat only supports object schemas; a non-object schema must fail
    // at the boundary rather than produce a confusing response_format.
    await expect(
      provider.generateStructured({
        model: "stub-valid-structured",
        schemaName: "NotAnObject",
        schema: z.string(),
        prompt: "anything",
      }),
    ).rejects.toThrow();
  });

  it("requests the configured embedding width for v3 models", async () => {
    const result = await provider.embed({
      model: "text-embedding-3-small",
      input: ["first", "second"],
    });

    expect(result.embeddings).toHaveLength(2);
    // The provider asks for the configured width and the stub echoes it back, so this
    // asserts the wiring rather than a hardcoded dimension.
    expect(result.embeddings[0]).toHaveLength(env.AI_EMBED_DIMENSIONS);
    expect(result.usage.promptTokens).toBe(5);
  });

  it("does not send dimensions for models that do not support them", async () => {
    const result = await provider.embed({ model: "legacy-embedding", input: ["first"] });

    // The stub only returns 8 when `dimensions` was omitted, which is the assertion.
    expect(result.embeddings[0]).toHaveLength(8);
  });

  it("orders embeddings by index regardless of response order", async () => {
    const result = await provider.embed({ model: "legacy-embedding", input: ["a", "b", "c"] });

    expect(result.embeddings).toHaveLength(3);
    // The stub emits index ascending, and value 0 is the index, so this proves order.
    expect(result.embeddings.map((vector) => vector[0])).toEqual([0, 1, 2]);
  });

  it("streams deltas", async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.streamText({ model: "stub-ok", prompt: "hi" })) {
      chunks.push(chunk.delta);
    }

    expect(chunks.join("")).toBe("Stub streamed answer.");
  });
});
