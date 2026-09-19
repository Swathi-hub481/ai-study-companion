import { computeMastery, type MasteryEvidence } from "@/lib/learning/mastery";

/**
 * Growth classification.
 *
 * `Concept.mastery` says where a learner *is*; this says which way they are moving, which
 * is the question the Growth view exists to answer. Kept Prisma-free so the rule can be
 * unit-tested and explained to a learner.
 *
 * The band is derived from the evidence *time series*, never from a single observation —
 * one good answer is not a trend.
 */

export type GrowthBand = "IMPROVING" | "STABLE" | "NEEDS_ATTENTION";

export type MasteryPoint = {
  at: Date;
  mastery: number;
};

/** Movement smaller than this is noise, not a trend. */
export const TREND_THRESHOLD = 0.05;

/** Below this, "not moving" is not good news — it is a problem. */
export const LOW_MASTERY_THRESHOLD = 0.4;

/** Trend lines longer than this stop being readable, and stop being cheap. */
export const SERIES_LIMIT = 20;

export type GrowthAssessment = {
  band: GrowthBand;
  /** Change in mastery between the earlier and recent halves of the evidence. */
  delta: number;
  /** Current estimate, equal to what `Concept.mastery` holds. */
  mastery: number;
};

/** One concept's growth, as the Growth view and the recommendation prompt both want it. */
export type ConceptGrowth = {
  conceptId: string;
  name: string;
  mastery: number;
  band: GrowthBand;
  delta: number;
  evidenceCount: number;
  series: MasteryPoint[];
};

/** Presentation order: what needs work comes first. */
export const GROWTH_BAND_ORDER: GrowthBand[] = ["NEEDS_ATTENTION", "IMPROVING", "STABLE"];

export const GROWTH_BAND_LABELS: Record<GrowthBand, string> = {
  NEEDS_ATTENTION: "Needs attention",
  IMPROVING: "Improving",
  STABLE: "Stable",
};

function chronological(evidence: MasteryEvidence[]): MasteryEvidence[] {
  return [...evidence].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Cumulative mastery after each observation, capped at the most recent `SERIES_LIMIT`.
 *
 * Each point is computed as of *its own* timestamp, so the line is a genuine history
 * rather than today's weighting projected backwards.
 */
export function masterySeries(evidence: MasteryEvidence[]): MasteryPoint[] {
  const ordered = chronological(evidence).slice(-SERIES_LIMIT);

  return ordered.map((row, index) => ({
    at: row.createdAt,
    mastery: computeMastery(ordered.slice(0, index + 1), row.createdAt),
  }));
}

export function classifyGrowth(
  evidence: MasteryEvidence[],
  now: Date = new Date(),
): GrowthAssessment {
  const ordered = chronological(evidence);
  const mastery = computeMastery(ordered, now);

  // One observation is not a trend; claiming otherwise would be dishonest.
  if (ordered.length < 2) {
    return { band: "STABLE", delta: 0, mastery };
  }

  const midpoint = Math.floor(ordered.length / 2);
  const earlier = computeMastery(ordered.slice(0, midpoint), now);
  const recent = computeMastery(ordered.slice(midpoint), now);
  const delta = Number((recent - earlier).toFixed(4));

  if (delta >= TREND_THRESHOLD) return { band: "IMPROVING", delta, mastery };
  if (delta <= -TREND_THRESHOLD) return { band: "NEEDS_ATTENTION", delta, mastery };

  // Flat. Holding steady is fine when mastery is decent, and a problem when it is not.
  return {
    band: mastery < LOW_MASTERY_THRESHOLD ? "NEEDS_ATTENTION" : "STABLE",
    delta,
    mastery,
  };
}
