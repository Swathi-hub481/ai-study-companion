import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { aiEmbed } from "@/lib/ai";
import { logger } from "@/lib/logger";
import type { ChunkDraft } from "@/lib/documents/chunk";

/**
 * Turns chunk drafts into searchable knowledge.
 *
 * Two things are worth calling out:
 *
 *  - **Idempotent.** Existing chunks for the material are removed first. Processing
 *    jobs can be retried, and a retry that appended a second copy of every chunk
 *    would quietly poison retrieval with duplicates.
 *
 *  - **Raw SQL for the vectors.** `Chunk.embedding` is an `Unsupported("vector")`
 *    column, so the Prisma client cannot write it. Updates are issued as one
 *    statement per batch rather than per row: a 100-page document is several hundred
 *    chunks, and hundreds of individual round-trips is the difference between a
 *    processing step that feels instant and one that does not.
 */

const EMBED_BATCH_SIZE = 64;

/** Formats a vector as the literal pgvector parses. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export type ReplaceChunksResult = {
  chunkCount: number;
  averageTokens: number;
};

export async function replaceChunks(params: {
  userId: string;
  projectId: string;
  materialId: string;
  drafts: ChunkDraft[];
}): Promise<ReplaceChunksResult> {
  const { userId, projectId, materialId, drafts } = params;

  // Delete first, then insert: a partially failed run leaves the material with no
  // chunks rather than a mixture of old and new, and the retry starts clean.
  await prisma.chunk.deleteMany({ where: { materialId } });

  if (drafts.length === 0) {
    return { chunkCount: 0, averageTokens: 0 };
  }

  // Ids are generated here so the embeddings can be attached in a follow-up
  // statement; `createMany` cannot return the rows it inserted.
  const rows = drafts.map((draft) => ({
    id: randomUUID(),
    projectId,
    materialId,
    content: draft.content,
    page: draft.page,
    ord: draft.ord,
    tokenCount: draft.tokenCount,
  }));

  await prisma.chunk.createMany({ data: rows, skipDuplicates: true });

  let embedded = 0;

  for (let offset = 0; offset < rows.length; offset += EMBED_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + EMBED_BATCH_SIZE);

    const vectors = await aiEmbed({
      context: { userId, projectId },
      inputs: batch.map((row) => row.content),
    });

    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding provider returned ${vectors.length} vectors for ${batch.length} inputs.`,
      );
    }

    const ids = batch.map((row) => row.id);
    const literals = vectors.map(toVectorLiteral);

    // Both arrays unnest in lockstep, so id[i] pairs with literal[i].
    await prisma.$executeRaw`
      UPDATE "Chunk" AS c
         SET embedding = source.embedding::vector
        FROM (
          SELECT unnest(${ids}::text[]) AS id,
                 unnest(${literals}::text[]) AS embedding
        ) AS source
       WHERE c.id = source.id
    `;

    embedded += batch.length;
  }

  const totalTokens = rows.reduce((total, row) => total + row.tokenCount, 0);

  logger.info(
    { materialId, chunkCount: rows.length, embedded },
    "Chunks stored with embeddings",
  );

  return {
    chunkCount: rows.length,
    averageTokens: Math.round(totalTokens / rows.length),
  };
}
