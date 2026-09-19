import { env } from "@/lib/config";
import { prisma } from "@/lib/db";
import { aiEmbed } from "@/lib/ai";
import { toVectorLiteral } from "@/lib/rag/embed";
import { timed, type TimingSession } from "@/lib/performance/timing";

/**
 * The read half of the retrieval layer.
 *
 * `lib/rag/embed.ts` writes vectors; this module queries them. The two constraints
 * that matter here:
 *
 *  - **Project scoping is a WHERE clause, never a post-filter.** `Chunk` carries
 *    `projectId` directly (denormalized on purpose), so retrieval can filter in a
 *    single indexed query and can never surface another Project's evidence.
 *
 *  - **Raw SQL.** `Chunk.embedding` is an `Unsupported("vector")` column, so the
 *    Prisma client cannot read it. The query vector is passed as a bound parameter
 *    and cast, matching the write path.
 */

export type RetrievedChunk = {
  id: string;
  materialId: string;
  /** Material filename, used as the citation title. */
  title: string;
  page: number | null;
  ord: number;
  content: string;
  /** Cosine similarity in roughly [0, 1]; higher is closer. */
  score: number;
};

type RetrievedRow = {
  id: string;
  materialId: string;
  title: string;
  page: number | null;
  ord: number;
  content: string;
  score: number;
};

export async function retrieveEvidence(params: {
  userId: string;
  projectId: string;
  query: string;
  topK?: number;
  minScore?: number;
  /**
   * A query vector the caller has already computed.
   *
   * Callers that retrieve for several queries at once (quiz generation asks one
   * question per concept) embed them in a single model call and pass the results in,
   * which is one model invocation instead of N. When absent the query is embedded
   * here, exactly as before.
   */
  queryEmbedding?: number[];
  /** Optional timing session; omitted everywhere except measurement runs. */
  timing?: TimingSession;
}): Promise<RetrievedChunk[]> {
  const query = params.query.trim();
  if (!query) return [];

  const topK = params.topK ?? env.RETRIEVAL_TOP_K;
  const minScore = params.minScore ?? env.RETRIEVAL_MIN_SCORE;

  const embedding =
    params.queryEmbedding ??
    (await timed(params.timing, "retrieve.embed", async () => {
      const [vector] = await aiEmbed({
        context: { userId: params.userId, projectId: params.projectId },
        inputs: [query],
      });

      return vector;
    }));

  if (!embedding) return [];

  const literal = toVectorLiteral(embedding);

  const rows = await timed(
    params.timing,
    "retrieve.sql",
    () =>
      prisma.$queryRaw<RetrievedRow[]>`
    WITH q AS (SELECT ${literal}::vector AS v)
    SELECT c.id,
           c."materialId" AS "materialId",
           m.filename     AS title,
           c.page         AS page,
           c.ord          AS ord,
           c.content      AS content,
           1 - (c.embedding <=> q.v) AS score
      FROM "Chunk" c
      JOIN "Material" m ON m.id = c."materialId"
     CROSS JOIN q
     WHERE c."projectId" = ${params.projectId}
       AND c.embedding IS NOT NULL
       AND m.status = 'READY'
     ORDER BY c.embedding <=> q.v ASC
     LIMIT ${topK}::int
  `,
  );

  // Thresholded in application code rather than SQL: the count is tiny (top-k) and
  // the rule stays visible and testable next to the constant that defines it.
  return rows.filter((row) => row.score >= minScore);
}
