import { describe, expect, it } from "vitest";
import { SERIES_LIMIT, classifyGrowth, masterySeries } from "@/lib/learning/growth";
import type { MasteryEvidence } from "@/lib/learning/mastery";

const now = new Date("2026-02-01T00:00:00Z");

function at(daysAgo: number, score: number, weight = 1): MasteryEvidence {
  return { score, weight, createdAt: new Date(now.getTime() - daysAgo * 86_400_000) };
}

describe("classifyGrowth", () => {
  it("reports stable rather than claiming a trend from one observation", () => {
    const result = classifyGrowth([at(1, 1)], now);

    expect(result.band).toBe("STABLE");
    expect(result.delta).toBe(0);
  });

  it("reports stable with no evidence at all", () => {
    expect(classifyGrowth([], now)).toEqual({ band: "STABLE", delta: 0, mastery: 0 });
  });

  it("reports improving when recent evidence beats earlier evidence", () => {
    const result = classifyGrowth([at(30, 0), at(1, 1)], now);

    expect(result.band).toBe("IMPROVING");
    expect(result.delta).toBeGreaterThan(0);
  });

  it("reports needs-attention when recent evidence is worse", () => {
    const result = classifyGrowth([at(30, 1), at(1, 0)], now);

    expect(result.band).toBe("NEEDS_ATTENTION");
    expect(result.delta).toBeLessThan(0);
  });

  it("treats a flat but low concept as needing attention", () => {
    // Holding steady at 20% is not success; the band must not imply it is.
    const result = classifyGrowth([at(10, 0.2), at(5, 0.2)], now);

    expect(result.delta).toBe(0);
    expect(result.band).toBe("NEEDS_ATTENTION");
  });

  it("treats a flat but decent concept as stable", () => {
    const result = classifyGrowth([at(10, 0.8), at(5, 0.8)], now);

    expect(result.delta).toBe(0);
    expect(result.band).toBe("STABLE");
  });

  it("reports the current mastery alongside the band", () => {
    const result = classifyGrowth([at(1, 0.6)], now);

    expect(result.mastery).toBeCloseTo(0.6, 4);
  });
});

describe("masterySeries", () => {
  it("returns points in chronological order", () => {
    const series = masterySeries([at(10, 0.2), at(1, 0.9)]);

    expect(series).toHaveLength(2);
    expect(series[0]!.at.getTime()).toBeLessThan(series[1]!.at.getTime());
  });

  it("values each point as of its own timestamp, not as of today", () => {
    // The first observation was a perfect score at the time; later evidence is what
    // drags the current estimate down. A trend that used today's weighting for every
    // point would show a flat line instead.
    const series = masterySeries([at(10, 1), at(0, 0)]);

    expect(series[0]?.mastery).toBeCloseTo(1, 4);
    expect(series[1]!.mastery).toBeLessThan(series[0]!.mastery);
  });

  it("caps the series so a long history cannot grow unbounded", () => {
    const evidence = Array.from({ length: SERIES_LIMIT + 10 }, (_, index) => at(index, 0.5));

    expect(masterySeries(evidence)).toHaveLength(SERIES_LIMIT);
  });

  it("returns nothing for no evidence", () => {
    expect(masterySeries([])).toEqual([]);
  });
});
