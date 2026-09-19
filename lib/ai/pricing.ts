import type { TokenUsage } from "@/lib/ai/types";

/**
 * Cost model.
 *
 * Prices are USD per 1,000,000 tokens and are kept as an explicit table rather than
 * fetched, so a provider price change is a reviewable one-line edit. An unknown
 * model records 0 cost and is reported as unpriced, which is honest — inventing a
 * number would be worse than admitting we do not know it.
 */

type Price = {
  input: number;
  output: number;
};

const PRICES: Record<string, Price> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

export function isModelPriced(model: string): boolean {
  return model in PRICES;
}

/** Returns USD cost, or 0 for an unpriced or unknown model. */
export function estimateCostUsd(model: string, usage: TokenUsage | undefined): number {
  if (!usage) return 0;

  const price = PRICES[model];
  if (!price) return 0;

  const input = (usage.promptTokens / 1_000_000) * price.input;
  const output = (usage.completionTokens / 1_000_000) * price.output;

  // Sub-cent precision matters when aggregating thousands of calls.
  return Number((input + output).toFixed(6));
}

export function listPricedModels(): string[] {
  return Object.keys(PRICES);
}
