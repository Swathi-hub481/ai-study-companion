import { estimateTokens } from "@/lib/ai/telemetry";
import type { ParsedPage } from "@/lib/documents/parse";

/**
 * Chunking.
 *
 * Design constraints, in priority order:
 *
 *  1. **A chunk never spans two pages.** Citations say "Page 14", so a chunk holding
 *     the end of page 14 and the start of page 15 could not be cited honestly.
 *  2. **Chunks are token-budgeted**, not character-budgeted, because the embedding and
 *     chat models are token-limited.
 *  3. **Consecutive chunks overlap**, so a fact split across a boundary is still
 *     wholly present in at least one chunk.
 *
 * Chunk boundaries follow sentence boundaries. Cutting mid-sentence measurably
 * degrades retrieval, since the embedding then represents a fragment.
 */

export type ChunkDraft = {
  content: string;
  page: number;
  /** Global position within the document, for stable ordering. */
  ord: number;
  tokenCount: number;
};

export type ChunkOptions = {
  targetTokens: number;
  overlapTokens: number;
};

/**
 * Splits on sentence-ending punctuation while keeping the punctuation attached.
 *
 * Fragments with no letter or digit are discarded. Extraction leaves behind stray
 * runs like "." or a lone page number, and turning those into chunks would add
 * meaningless rows to the index and dilute retrieval.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

function totalTokens(parts: string[]): number {
  return parts.reduce((total, part) => total + estimateTokens(part), 0);
}

/** The trailing sentences whose combined size is closest to the overlap budget. */
function trailingOverlap(parts: string[], overlapTokens: number): string[] {
  const overlap: string[] = [];
  let tokens = 0;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    const partTokens = estimateTokens(part);

    if (tokens + partTokens > overlapTokens) break;

    overlap.unshift(part);
    tokens += partTokens;
  }

  // A single trailing sentence larger than the budget is still worth carrying, as
  // long as it is not the whole chunk.
  if (overlap.length === 0 && parts.length > 1) {
    return [parts[parts.length - 1]!];
  }

  return overlap;
}

export function chunkPages(pages: ParsedPage[], options: ChunkOptions): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let ord = 0;

  for (const page of pages) {
    const sentences = splitSentences(page.text);

    if (sentences.length === 0) continue;

    let buffer: string[] = [];
    let bufferTokens = 0;

    const flush = () => {
      if (buffer.length === 0) return;

      const content = buffer.join(" ").trim();
      if (content.length > 0) {
        chunks.push({ content, page: page.page, ord, tokenCount: totalTokens(buffer) });
        ord += 1;
      }
    };

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);

      if (buffer.length > 0 && bufferTokens + sentenceTokens > options.targetTokens) {
        flush();

        const overlap = trailingOverlap(buffer, options.overlapTokens);
        buffer = [...overlap];
        bufferTokens = totalTokens(buffer);
      }

      buffer.push(sentence);
      bufferTokens += sentenceTokens;
    }

    flush();
  }

  return chunks;
}

/** Average chunk size, for the diagnostics shown on the materials view. */
export function averageChunkTokens(chunks: ChunkDraft[]): number {
  if (chunks.length === 0) return 0;
  return Math.round(chunks.reduce((total, chunk) => total + chunk.tokenCount, 0) / chunks.length);
}
