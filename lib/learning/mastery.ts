/**
 * Mastery estimation from append-only evidence.
 *
 * `Concept.mastery` is a float that is *derived* — it exists so dashboards can read a
 * single number instead of replaying history. This module owns the derivation, kept
 * Prisma-free so the formula can be unit-tested directly and explained to a learner.
 *
 * Evidence is recency-weighted rather than averaged flat: a learner who got something
 * wrong a month ago and right today should not be dragged down by the old attempt.
 */

export type MasteryEvidence = {
  score: number;
  weight: number;
  createdAt: Date;
};

/** After this long, an observation counts half as much as a fresh one. */
export const MASTERY_HALF_LIFE_DAYS = 14;

/** Only the most recent rows are considered, so cost stays bounded as history grows. */
export const MASTERY_EVIDENCE_LIMIT = 20;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function computeMastery(evidence: MasteryEvidence[], now: Date = new Date()): number {
  if (evidence.length === 0) return 0;

  const recent = [...evidence]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MASTERY_EVIDENCE_LIMIT);

  let weightedScore = 0;
  let totalWeight = 0;

  for (const row of recent) {
    // Future timestamps (clock skew) must not produce a weight above 1.
    const ageDays = Math.max(0, (now.getTime() - row.createdAt.getTime()) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / MASTERY_HALF_LIFE_DAYS);
    const weight = Math.max(0, row.weight) * recency;

    weightedScore += weight * clamp01(row.score);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  // Rounded so the stored value does not wobble on floating-point noise alone.
  return Number(clamp01(weightedScore / totalWeight).toFixed(4));
}
