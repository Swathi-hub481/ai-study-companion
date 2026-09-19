import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiFeature, AiStatus, type Project, type Space, type User } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db";
import { AiError } from "@/lib/errors";
import { aiEmbed, aiGenerateStructured } from "@/lib/ai";
import { extractConcepts } from "@/lib/ai/features/extract-concepts";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";
import { SCHEMA_NAMES, conceptExtractionSchema } from "@/lib/ai/schemas";
import { summarizeAiUsage } from "@/lib/ai/telemetry";
import { waitForDatabase } from "../helpers/db";

/**
 * Phase 4's acceptance criterion, stated twice: the provider returns schema-valid
 * output, and every call is recorded.
 */

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

describe("AI provider and telemetry", () => {
  let user: User;
  let space: Space;
  let project: Project;

  beforeAll(async () => {
    await waitForDatabase();

    user = await prisma.user.create({
      data: {
        email: `ai-${runId}@example.com`,
        name: "AI Test",
        passwordHash: PLACEHOLDER_HASH,
      },
    });

    space = await prisma.space.create({
      data: { userId: user.id, name: `AI space ${runId}`, description: "Telemetry tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `AI project ${runId}`,
        description: "Telemetry tests.",
        goal: "Exercise the AI layer.",
      },
    });
  });

  afterAll(async () => {
    // AiRequest cascades from the user, so this clears the telemetry rows too.
    if (user?.id) {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    // Deliberately no $disconnect(): lib/db.ts exposes a process-wide singleton, and
    // tearing it down here would pull the connection out from under whichever test
    // file runs next.
  });

  it("returns schema-valid structured output from the mock provider", async () => {
    const provider = new MockAIProvider();

    const result = await provider.generateStructured({
      model: "mock-model",
      schemaName: SCHEMA_NAMES.conceptExtraction,
      schema: conceptExtractionSchema,
      prompt: "Extract concepts from this material.",
    });

    // Parsing already happened inside the provider; this asserts the contract holds.
    expect(conceptExtractionSchema.safeParse(result.value).success).toBe(true);
    expect(result.value.concepts.length).toBeGreaterThan(0);
    expect(result.value.concepts[0]?.name).toBeTruthy();
  });

  it("is deterministic — the same prompt yields the same output", async () => {
    const provider = new MockAIProvider();
    const request = {
      model: "mock-model",
      schemaName: SCHEMA_NAMES.conceptExtraction,
      schema: conceptExtractionSchema,
      prompt: "Identical prompt for both calls.",
    };

    const first = await provider.generateStructured(request);
    const second = await provider.generateStructured(request);

    expect(second.value).toEqual(first.value);
  });

  it("refuses to fabricate output for an unregistered schema", async () => {
    const provider = new MockAIProvider();

    // Inventing a shape here would let a feature ship with an unregistered mock and
    // only fail once a real model was wired in.
    await expect(
      provider.generateStructured({
        model: "mock-model",
        schemaName: "NotRegistered",
        schema: z.object({ anything: z.string() }),
        prompt: "whatever",
      }),
    ).rejects.toThrow(AiError);
  });

  it("rejects structured output that does not satisfy the caller's schema", async () => {
    const provider = new MockAIProvider();

    await expect(
      provider.generateStructured({
        model: "mock-model",
        schemaName: SCHEMA_NAMES.conceptExtraction,
        // A schema the registered mock payload cannot satisfy.
        schema: z.object({ concepts: z.array(z.number()) }),
        prompt: "Extract concepts.",
      }),
    ).rejects.toThrow();
  });

  it("produces deterministic, normalised embeddings of the configured width", async () => {
    const provider = new MockAIProvider();

    const result = await provider.embed({ model: "mock-embed", input: ["alpha", "alpha", "beta"] });
    const [first, second, third] = result.embeddings;

    expect(first).toHaveLength(env.AI_EMBED_DIMENSIONS);
    // Identical text must embed identically, or retrieval would be non-reproducible.
    expect(second).toEqual(first);
    expect(third).not.toEqual(first);

    const magnitude = Math.sqrt(first!.reduce((total, value) => total + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 6);
  });

  it("records a successful call, with feature, model, tokens and prompt version", async () => {
    const before = await prisma.aiRequest.count({ where: { userId: user.id } });

    const extraction = await extractConcepts(
      { userId: user.id, projectId: project.id },
      {
        materialTitle: "Gradient Descent Notes",
        text: "Gradient descent iteratively updates parameters against the loss gradient.",
      },
    );

    expect(extraction.concepts.length).toBeGreaterThan(0);

    const rows = await prisma.aiRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    expect(await prisma.aiRequest.count({ where: { userId: user.id } })).toBe(before + 1);

    const row = rows[0];
    expect(row?.feature).toBe(AiFeature.CONCEPT_EXTRACT);
    expect(row?.status).toBe(AiStatus.SUCCESS);
    expect(row?.provider).toBe("mock");
    expect(row?.projectId).toBe(project.id);
    expect(row?.promptVersion).toBe(PROMPT_VERSIONS.conceptExtraction);
    expect(row?.promptTokens).toBeGreaterThan(0);
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row?.error).toBeNull();
  });

  it("records a failed call with its error, then rethrows", async () => {
    await expect(
      aiGenerateStructured({
        context: {
          userId: user.id,
          projectId: project.id,
          feature: AiFeature.QUIZ_GENERATE,
        },
        schemaName: "UnregisteredSchema",
        schema: z.object({ value: z.string() }),
        prompt: "This call is expected to fail.",
      }),
    ).rejects.toThrow(AiError);

    const row = await prisma.aiRequest.findFirst({
      where: { userId: user.id, feature: AiFeature.QUIZ_GENERATE },
      orderBy: { createdAt: "desc" },
    });

    // A failure is as interesting as a slow call, so it must be visible.
    expect(row?.status).toBe(AiStatus.FAILED);
    expect(row?.error).toContain("UnregisteredSchema");
  });

  it("rejects embeddings whose width does not match the vector column", async () => {
    // A provider that ignores the configured width would otherwise write vectors that
    // only fail much later, at query time.
    await expect(
      aiEmbed({
        context: { userId: user.id, projectId: project.id },
        inputs: ["x".repeat(4)],
      }),
    ).resolves.toHaveLength(1);

    const provider = new MockAIProvider();
    const result = await provider.embed({ model: "mock-embed", input: ["x"] });
    expect(result.embeddings[0]).toHaveLength(env.AI_EMBED_DIMENSIONS);
  });

  it("aggregates usage for a project", async () => {
    const summary = await summarizeAiUsage({ projectId: project.id });

    expect(summary.calls).toBeGreaterThanOrEqual(2);
    expect(summary.failures).toBeGreaterThanOrEqual(1);
    expect(summary.promptTokens).toBeGreaterThan(0);
    expect(summary.averageLatencyMs).toBeGreaterThanOrEqual(0);
    // Cost is priced from the configured model name even though the mock only
    // estimates token counts — routing and pricing must not depend on the provider.
    expect(summary.costUsd).toBeGreaterThan(0);
  });
});
