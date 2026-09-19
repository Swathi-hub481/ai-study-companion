import type { Citation } from "@/lib/learning/tutor";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

/**
 * Citations are derived from what was actually retrieved, never from what the model
 * wrote. The answer streams as free text and the model is asked to name its sources,
 * but the citation list attached to a Message is the evidence list — so a fabricated
 * source cannot appear.
 */

/**
 * Collapses retrieved chunks into one citation per (material, page), keeping the
 * strongest score, so a document that contributed several passages is cited once per
 * page rather than repeatedly.
 */
export function buildCitations(chunks: RetrievedChunk[], limit = 8): Citation[] {
  const best = new Map<string, Citation>();

  for (const chunk of chunks) {
    const key = `${chunk.materialId}:${chunk.page ?? "none"}`;
    const existing = best.get(key);

    if (!existing || chunk.score > existing.score) {
      best.set(key, {
        materialId: chunk.materialId,
        title: chunk.title,
        page: chunk.page,
        score: Number(chunk.score.toFixed(3)),
      });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
