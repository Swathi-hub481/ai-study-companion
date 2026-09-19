import { describe, expect, it } from "vitest";
import { averageChunkTokens, chunkPages, splitSentences } from "@/lib/documents/chunk";
import { estimateTokens } from "@/lib/ai/telemetry";

const page = (pageNumber: number, text: string) => ({ page: pageNumber, text });

describe("splitSentences", () => {
  it("keeps terminal punctuation attached", () => {
    expect(splitSentences("First sentence. Second sentence! Third?")) .toEqual([
      "First sentence.",
      "Second sentence!",
      "Third?",
    ]);
  });

  it("drops empty fragments", () => {
    expect(splitSentences("One.   .  Two.")).toEqual(["One.", "Two."]);
  });
});

describe("chunkPages", () => {
  const options = { targetTokens: 40, overlapTokens: 8 };

  it("never lets a chunk span two pages", () => {
    // Citations name a page, so a chunk crossing a boundary could not be cited honestly.
    const pages = [
      page(1, "Alpha one. Alpha two. Alpha three."),
      page(2, "Beta one. Beta two."),
    ];

    const chunks = chunkPages(pages, { targetTokens: 1000, overlapTokens: 10 });

    expect(new Set(chunks.map((chunk) => chunk.page))).toEqual(new Set([1, 2]));

    // The real invariant: each chunk's text is contained entirely within its own page.
    for (const chunk of chunks) {
      const source = pages.find((candidate) => candidate.page === chunk.page)!.text;
      expect(source).toContain(chunk.content);
    }
  });

  it("respects the token budget", () => {
    const long = Array.from({ length: 20 }, (_, index) => `Sentence number ${index} about learning.`).join(" ");

    const chunks = chunkPages([page(1, long)], options);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A single sentence may exceed the budget, but never two.
      expect(chunk.tokenCount).toBeLessThanOrEqual(options.targetTokens * 2);
    }
  });

  it("overlaps consecutive chunks so no sentence is lost at a boundary", () => {
    const sentences = Array.from({ length: 8 }, (_, index) => `Distinct sentence ${index} here.`);
    const chunks = chunkPages([page(1, sentences.join(" "))], { targetTokens: 24, overlapTokens: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    // The last sentence of one chunk reappears at the start of the next.
    const firstChunkTail = splitSentences(chunks[0]!.content).at(-1);
    expect(chunks[1]!.content).toContain(firstChunkTail!);
  });

  it("numbers chunks sequentially across pages", () => {
    const chunks = chunkPages(
      [page(1, "One. Two."), page(2, "Three. Four."), page(3, "Five.")],
      { targetTokens: 1000, overlapTokens: 0 },
    );

    expect(chunks.map((chunk) => chunk.ord)).toEqual(chunks.map((_, index) => index));
  });

  it("skips pages with no text", () => {
    const chunks = chunkPages([page(1, "   "), page(2, "Real content here.")], {
      targetTokens: 100,
      overlapTokens: 0,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.page).toBe(2);
  });

  it("returns nothing for an empty document", () => {
    expect(chunkPages([], options)).toEqual([]);
  });

  it("counts tokens per chunk", () => {
    const text = "Short sentence.";
    const chunks = chunkPages([page(1, text)], options);

    expect(chunks[0]?.tokenCount).toBe(estimateTokens(text));
  });
});

describe("averageChunkTokens", () => {
  it("is zero for no chunks", () => {
    expect(averageChunkTokens([])).toBe(0);
  });

  it("rounds to a whole number", () => {
    const chunks = [
      { content: "a", page: 1, ord: 0, tokenCount: 10 },
      { content: "b", page: 1, ord: 1, tokenCount: 21 },
    ];

    expect(averageChunkTokens(chunks)).toBe(16);
  });
});
