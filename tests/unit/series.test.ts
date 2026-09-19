import { describe, expect, it } from "vitest";
import {
  bucketByDay,
  buildHeatmap,
  dayKey,
  startOfUtcDay,
  totalCount,
} from "@/lib/analytics/series";

// 2026-02-15 is a Sunday, so a five-day window starts on Wednesday 2026-02-11.
const NOW = new Date("2026-02-15T12:00:00Z");

function at(iso: string): { createdAt: Date } {
  return { createdAt: new Date(iso) };
}

describe("bucketByDay", () => {
  it("includes days with no activity, so gaps are not compressed", () => {
    const buckets = bucketByDay([], 5, NOW);

    expect(buckets).toHaveLength(5);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
    expect(buckets[0]?.day).toBe("2026-02-11");
    expect(buckets[4]?.day).toBe("2026-02-15");
  });

  it("returns days oldest first", () => {
    const days = bucketByDay([], 3, NOW).map((bucket) => bucket.day);

    expect(days).toEqual(["2026-02-13", "2026-02-14", "2026-02-15"]);
  });

  it("counts an event into its own UTC day", () => {
    const buckets = bucketByDay([at("2026-02-13T23:30:00Z")], 5, NOW);

    expect(buckets.find((bucket) => bucket.day === "2026-02-13")?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.day === "2026-02-14")?.count).toBe(0);
  });

  it("ignores events outside the window", () => {
    const buckets = bucketByDay([at("2026-01-01T00:00:00Z")], 5, NOW);

    expect(totalCount(buckets)).toBe(0);
  });

  it("counts several events on the same day", () => {
    const buckets = bucketByDay(
      [at("2026-02-15T01:00:00Z"), at("2026-02-15T09:00:00Z"), at("2026-02-15T20:00:00Z")],
      5,
      NOW,
    );

    expect(totalCount(buckets)).toBe(3);
    expect(buckets[4]?.count).toBe(3);
  });

  it("returns nothing for a non-positive window", () => {
    expect(bucketByDay([], 0, NOW)).toEqual([]);
    expect(bucketByDay([], -3, NOW)).toEqual([]);
  });
});

describe("dayKey / startOfUtcDay", () => {
  it("keys by UTC date rather than local time", () => {
    expect(dayKey(new Date("2026-02-15T23:59:59Z"))).toBe("2026-02-15");
    expect(dayKey(new Date("2026-02-16T00:00:01Z"))).toBe("2026-02-16");
  });

  it("truncates to midnight UTC", () => {
    expect(startOfUtcDay(new Date("2026-02-15T12:34:56Z")).toISOString()).toBe(
      "2026-02-15T00:00:00.000Z",
    );
  });
});

describe("buildHeatmap", () => {
  it("returns an empty grid when there is nothing to plot", () => {
    expect(buildHeatmap([])).toEqual({ cells: [], weeks: 0 });
  });

  it("pads the first column so each weekday keeps its own row", () => {
    const { cells, weeks } = buildHeatmap(bucketByDay([], 5, NOW));

    // Wednesday through Sunday: the first four cells share column 0, the fifth wraps.
    expect(cells[0]).toMatchObject({ week: 0, weekday: 3 });
    expect(cells[3]).toMatchObject({ week: 0, weekday: 6 });
    expect(cells[4]).toMatchObject({ week: 1, weekday: 0 });
    expect(weeks).toBe(2);
  });

  it("gives the busiest day the highest intensity", () => {
    const buckets = bucketByDay(
      [
        at("2026-02-11T10:00:00Z"),
        at("2026-02-12T10:00:00Z"),
        at("2026-02-12T11:00:00Z"),
        at("2026-02-13T10:00:00Z"),
        at("2026-02-13T11:00:00Z"),
        at("2026-02-13T12:00:00Z"),
        at("2026-02-13T13:00:00Z"),
      ],
      5,
      NOW,
    );

    const { cells } = buildHeatmap(buckets);

    expect(cells.find((cell) => cell.day === "2026-02-15")?.level).toBe(0);
    expect(cells.find((cell) => cell.day === "2026-02-11")?.level).toBe(1);
    expect(cells.find((cell) => cell.day === "2026-02-12")?.level).toBe(2);
    expect(cells.find((cell) => cell.day === "2026-02-13")?.level).toBe(4);
  });

  it("carries the count through so the tooltip can show it", () => {
    const { cells } = buildHeatmap(bucketByDay([at("2026-02-15T10:00:00Z")], 2, NOW));

    expect(cells.find((cell) => cell.day === "2026-02-15")).toMatchObject({ count: 1 });
  });
});
