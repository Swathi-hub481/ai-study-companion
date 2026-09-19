import type { NextStep } from "@/lib/learning/next-step";
import type { RecommendationLike } from "@/lib/learning/recommendation";

/**
 * The single "what should I do next?" value the dashboard renders.
 *
 * Two sources feed it, and which one is in use is always shown:
 *  - a generated **recommendation**, when the model has produced one that is still open;
 *  - otherwise the deterministic **heuristic** from `next-step.ts`.
 *
 * Keeping them behind one type means the dashboard cannot accidentally present a
 * generated suggestion as though it were a computed fact, or vice versa.
 */

export type NextActionSource = "recommendation" | "heuristic";

export type NextAction = {
  title: string;
  body: string;
  /** Why this was suggested. Rendered verbatim, so it is never implied. */
  basis: string;
  source: NextActionSource;
  priority: number | null;
};

const STEP_BASIS: Record<NextStep["basis"], string> = {
  materials: "Based on your materials",
  processing: "Based on processing status",
  assessment: "Based on your assessment history",
  mastery: "Based on your concept mastery",
  exploration: "Based on your progress so far",
};

export function fromRecommendation(recommendation: RecommendationLike): NextAction {
  return {
    title: recommendation.title,
    body: recommendation.body,
    basis: recommendation.reason?.trim() || "Based on your recent performance",
    source: "recommendation",
    priority: recommendation.priority,
  };
}

export function fromNextStep(step: NextStep): NextAction {
  return {
    title: step.title,
    body: step.body,
    basis: STEP_BASIS[step.basis],
    source: "heuristic",
    priority: null,
  };
}
