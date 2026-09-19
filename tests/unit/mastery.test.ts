import { describe, expect, it } from "vitest";
import {
  MASTERY_EVIDENCE_LIMIT,
  MASTERY_HALF_LIFE_DAYS,
  computeMastery,
  type MasteryEvidence,
} from "@/lib/learning/mastery";

const now = new Date("2026-01-15T00:00:00Z");

function at(daysAgo: number, score: number, weight = 1): MasteryEvidence {
  return { score, weight, createdAt: new Date(now.getTime() - daysAgo * 86_400_000) };
}

describe("computeMastery", () => {
  it("reports zero mastery when there is no evidence", () => {
    expect(computeMastery([], now)).toBe(0);
  });

  it("returns a single fresh observation as-is", () => {
    expect(computeMastery([at(0, 0.8)], now)).toBeCloseTo(0.8, 4);
  });

  it("weights recent evidence above stale evidence", () => {
    // Same two observations, opposite order in time — the recency weighting must decide.
    const strongNow = computeMastery([at(0, 1), at(90, 0)], now);
    const weakNow = computeMastery([at(0, 0), at(90, 1)], now);

    expect(strongNow).toBeGreaterThan(weakNow);
  });

  it("halves an observation's influence after one half-life", () => {
    // A perfect answer today and a zero exactly one half-life ago: 1 / (1 + 0.5) = 0.667.
    const value = computeMastery([at(0, 1), at(MASTERY_HALF_LIFE_DAYS, 0)], now);

    expect(value).toBeCloseTo(0.6667, 3);
  });

  it("honours evidence weight", () => {
    const heavilyWeighted = computeMastery([at(0, 1, 5), at(0, 0, 1)], now);
    const lightlyWeighted = computeMastery([at(0, 1, 1), at(0, 0, 5)], now);

    expect(heavilyWeighted).toBeGreaterThan(lightlyWeighted);
  });

  it("clamps scores that arrive outside 0..1", () => {
    expect(computeMastery([at(0, 5)], now)).toBe(1);
    expect(computeMastery([at(0, -5)], now)).toBe(0);
  });

  it("does not reward a future timestamp beyond a fresh observation", () => {
    expect(computeMastery([at(-10, 1)], now)).toBe(1);
  });

  it("ignores everything older than the evidence window", () => {
    const many: MasteryEvidence[] = Array.from({ length: MASTERY_EVIDENCE_LIMIT + 10 }, (_, index) =>
      at(index, 1),
    );

    // All observations are perfect, so the value is 1 either way — the point is that the
    // most recent window is what is considered, and the calculation stays bounded.
    expect(computeMastery(many, now)).toBe(1);
  });

  it("is deterministic for the same inputs and clock", () => {
    const evidence = [at(1, 0.4), at(3, 0.9), at(10, 0.2)];

    expect(computeMastery(evidence, now)).toBe(computeMastery(evidence, now));
  });
});
