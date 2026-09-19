import { describe, expect, it } from "vitest";
import { estimateCostUsd, isModelPriced, listPricedModels } from "@/lib/ai/pricing";
import { estimateTokens, measureUsage } from "@/lib/ai/telemetry";
import type { TokenUsage } from "@/lib/ai/types";

const usage = (promptTokens: number, completionTokens: number): TokenUsage => ({
  promptTokens,
  completionTokens,
  estimated: false,
});

describe("estimateCostUsd", () => {
  it("prices input and output tokens separately", () => {
    // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output.
    expect(estimateCostUsd("gpt-4o-mini", usage(1_000_000, 1_000_000))).toBeCloseTo(0.75, 6);
  });

  it("scales down to realistic per-call sizes", () => {
    const cost = estimateCostUsd("gpt-4o-mini", usage(2_000, 500));

    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  it("prices embeddings with no output cost", () => {
    expect(estimateCostUsd("text-embedding-3-small", usage(1_000_000, 0))).toBeCloseTo(0.02, 6);
  });

  it("records 0 for an unpriced model rather than inventing a number", () => {
    expect(estimateCostUsd("some-future-model", usage(1_000_000, 1_000_000))).toBe(0);
    expect(isModelPriced("some-future-model")).toBe(false);
  });

  it("records 0 when usage is missing", () => {
    expect(estimateCostUsd("gpt-4o-mini", undefined)).toBe(0);
  });

  it("keeps enough precision to aggregate many cheap calls", () => {
    const perCall = estimateCostUsd("gpt-4o-mini", usage(100, 50));
    expect(perCall).toBeGreaterThan(0);
  });

  it("knows the models it prices", () => {
    expect(listPricedModels()).toContain("gpt-4o-mini");
    expect(isModelPriced("gpt-4o-mini")).toBe(true);
  });
});

describe("measureUsage", () => {
  it("prefers provider-reported usage", () => {
    const reported = usage(10, 20);
    expect(measureUsage("a long prompt", "a long completion", reported)).toBe(reported);
  });

  it("falls back to a flagged local estimate", () => {
    const measured = measureUsage("12345678", "1234");

    expect(measured.estimated).toBe(true);
    expect(measured.promptTokens).toBe(2);
    expect(measured.completionTokens).toBe(1);
  });
});

describe("estimateTokens", () => {
  it("estimates roughly four characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
