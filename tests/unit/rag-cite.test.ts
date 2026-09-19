import { describe, expect, it } from "vitest";
import { buildCitations } from "@/lib/rag/cite";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk",
    materialId: "material-1",
    title: "Notes",
    page: 1,
    ord: 0,
    content: "content",
    score: 0.5,
    ...overrides,
  };
}

describe("buildCitations", () => {
  it("collapses chunks per material and page, keeping the strongest score", () => {
    const citations = buildCitations([
      chunk({ id: "a", materialId: "m1", page: 3, score: 0.4 }),
      chunk({ id: "b", materialId: "m1", page: 3, score: 0.8 }),
      chunk({ id: "c", materialId: "m1", page: 4, score: 0.6 }),
    ]);

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ materialId: "m1", page: 3, score: 0.8 });
    expect(citations[1]).toMatchObject({ materialId: "m1", page: 4, score: 0.6 });
  });

  it("rounds scores to three decimals", () => {
    expect(buildCitations([chunk({ score: 0.123456 })])[0]?.score).toBe(0.123);
  });

  it("orders by score and respects the limit", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      chunk({ id: `c${index}`, page: index, score: index / 20 }),
    );

    const citations = buildCitations(many, 5);

    expect(citations).toHaveLength(5);
    expect(citations[0]!.score).toBeGreaterThanOrEqual(citations[1]!.score);
  });

  it("keeps a document-level citation when the page is unknown", () => {
    expect(buildCitations([chunk({ page: null })])[0]?.page).toBeNull();
  });
});
