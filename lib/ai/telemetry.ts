import { AiStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { estimateCostUsd, isModelPriced } from "@/lib/ai/pricing";
import type { TokenUsage } from "@/lib/ai/types";

/**
 * AI observability.
 *
 * Every model call lands as one row, which is what makes the PRD's investigation
 * questions answerable after the fact: why was a response slow, which model ran,
 * how much did it cost, which workflow failed.
 */

export type AICallContext = {
  userId: string;
  projectId?: string | null;
  /** Mirrors the AiFeature enum so usage can be sliced by capability. */
  feature: import("@prisma/client").AiFeature;
  /** Identifies the prompt template revision, so quality shifts can be correlated. */
  promptVersion?: string;
};

/**
 * Local token estimate, used only when a provider reports no usage (the mock, or a
 * failed call). Deliberately crude and flagged as estimated in the stored row, so it
 * is never mistaken for a real count.
 */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function measureUsage(
  prompt: string,
  completion: string,
  reported?: TokenUsage,
): TokenUsage {
  if (reported) return reported;

  return {
    promptTokens: estimateTokens(prompt),
    completionTokens: estimateTokens(completion),
    estimated: true,
  };
}

const warnedModels = new Set<string>();

function costFor(model: string, usage: TokenUsage | undefined): number {
  if (usage && !isModelPriced(model) && !warnedModels.has(model)) {
    warnedModels.add(model);
    logger.warn({ model }, "AI model has no price entry; cost will be recorded as 0");
  }

  return estimateCostUsd(model, usage);
}

export async function recordAiRequest(entry: {
  context: AICallContext;
  provider: string;
  model: string;
  usage?: TokenUsage;
  latencyMs: number;
  status: AiStatus;
  error?: string;
}): Promise<void> {
  try {
    await prisma.aiRequest.create({
      data: {
        userId: entry.context.userId,
        projectId: entry.context.projectId ?? null,
        feature: entry.context.feature,
        provider: entry.provider,
        model: entry.model,
        promptTokens: entry.usage?.promptTokens ?? 0,
        completionTokens: entry.usage?.completionTokens ?? 0,
        latencyMs: entry.latencyMs,
        costUsd: costFor(entry.model, entry.usage),
        status: entry.status,
        // Truncated: an error string is diagnostic context, not a transcript store.
        error: entry.error ? entry.error.slice(0, 500) : null,
        promptVersion: entry.context.promptVersion ?? null,
      },
    });
  } catch (error) {
    // Observability must never break the feature it is observing.
    logger.error({ err: error }, "Failed to record AI request");
  }
}

/** Aggregated usage for a Project — surfaced on the analytics and admin views. */
export async function summarizeAiUsage(where: {
  userId?: string;
  projectId?: string;
}): Promise<{
  calls: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  averageLatencyMs: number;
}> {
  const aggregate = await prisma.aiRequest.aggregate({
    where,
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    _avg: { latencyMs: true },
  });

  const failures = await prisma.aiRequest.count({ where: { ...where, status: AiStatus.FAILED } });

  return {
    calls: aggregate._count._all,
    failures,
    promptTokens: aggregate._sum.promptTokens ?? 0,
    completionTokens: aggregate._sum.completionTokens ?? 0,
    costUsd: Number((aggregate._sum.costUsd ?? 0).toFixed(6)),
    averageLatencyMs: Math.round(aggregate._avg.latencyMs ?? 0),
  };
}
