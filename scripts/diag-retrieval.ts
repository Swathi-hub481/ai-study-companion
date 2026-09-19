/**
 * Temporary diagnostic for the Phase 6 retrieval pipeline.
 *
 * Prints the configured provider, the query embedding, and the raw pgvector cosine
 * similarities for a question — with and without the RETRIEVAL_MIN_SCORE filter — so
 * the evidence gate's decision can be inspected directly.
 *
 * Usage: npx tsx scripts/diag-retrieval.ts "your question"
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

const QUESTION = process.argv[2] ?? "What projects are mentioned in my uploaded resume?";

async function main() {
  // Imported dynamically so `.env` is loaded before any module reads configuration.
  const { env } = await import("../lib/config");
  const { prisma } = await import("../lib/db");
  const { aiEmbed } = await import("../lib/ai");
  const { toVectorLiteral } = await import("../lib/rag/embed");
  const { retrieveEvidence } = await import("../lib/rag/retrieve");

  console.log("=== configuration ===");
  console.log("AI_PROVIDER          :", env.AI_PROVIDER);
  console.log("AI_EMBED_MODEL       :", env.AI_EMBED_MODEL);
  console.log("AI_EMBED_DIMENSIONS  :", env.AI_EMBED_DIMENSIONS);
  console.log("RETRIEVAL_TOP_K      :", env.RETRIEVAL_TOP_K);
  console.log("RETRIEVAL_MIN_SCORE  :", env.RETRIEVAL_MIN_SCORE);

  const material = await prisma.material.findFirst({
    where: { filename: { contains: "Resume" }, status: "READY" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      projectId: true,
      project: { select: { name: true, space: { select: { userId: true } } } },
    },
  });

  if (!material) {
    console.log("No READY material matching 'Resume' found.");
    return;
  }

  const userId = material.project.space.userId;

  console.log("\n=== material ===");
  console.log("id      :", material.id);
  console.log("file    :", material.filename);
  console.log("project :", material.project.name, material.projectId);
  console.log("owner   :", userId);

  const stats = await prisma.$queryRaw<
    Array<{ chunks: bigint; with_embedding: bigint; dims: number }>
  >`
    SELECT count(*) AS chunks,
           count(embedding) AS with_embedding,
           min(vector_dims(embedding))::int AS dims
      FROM "Chunk"
     WHERE "materialId" = ${material.id}
  `;
  console.log("chunks  :", Number(stats[0]?.chunks), "with embedding:",
    Number(stats[0]?.with_embedding), "dims:", stats[0]?.dims);

  console.log("\n=== query ===");
  console.log(QUESTION);

  const [queryVector] = await aiEmbed({
    context: { userId, projectId: material.projectId },
    inputs: [QUESTION],
  });

  console.log("embedding dims:", queryVector?.length);
  console.log(
    "embedding norm:",
    queryVector ? Math.sqrt(queryVector.reduce((t, v) => t + v * v, 0)).toFixed(6) : "n/a",
  );

  if (!queryVector) {
    console.log("!! no query embedding produced");
    return;
  }

  const literal = toVectorLiteral(queryVector);

  console.log("\n=== raw cosine similarities (no threshold) ===");
  const rows = await prisma.$queryRaw<
    Array<{ ord: number; page: number | null; score: number; snippet: string }>
  >`
    WITH q AS (SELECT ${literal}::vector AS v)
    SELECT c.ord,
           c.page,
           1 - (c.embedding <=> q.v) AS score,
           left(replace(c.content, E'\n', ' '), 70) AS snippet
      FROM "Chunk" c
     CROSS JOIN q
     WHERE c."projectId" = ${material.projectId}
       AND c."materialId" = ${material.id}
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> q.v ASC
  `;

  for (const row of rows) {
    console.log(
      `ord=${row.ord} page=${row.page} score=${row.score.toFixed(6)}  ${row.snippet}`,
    );
  }

  const best = rows[0]?.score ?? 0;
  console.log("best raw score:", best.toFixed(6), " threshold:", env.RETRIEVAL_MIN_SCORE);

  console.log("\n=== retrieveEvidence (with filter) ===");
  const retrieved = await retrieveEvidence({
    userId,
    projectId: material.projectId,
    query: QUESTION,
  });
  console.log("returned chunks:", retrieved.length);
  for (const chunk of retrieved) {
    console.log(`  score=${chunk.score.toFixed(6)} ord=${chunk.ord} page=${chunk.page}`);
  }

  console.log("\n=== control: same chunk compared to itself ===");
  const selfRow = await prisma.$queryRaw<Array<{ score: number }>>`
    SELECT 1 - (embedding <=> embedding) AS score
      FROM "Chunk"
     WHERE "materialId" = ${material.id}
     LIMIT 1
  `;
  console.log("self-similarity:", selfRow[0]?.score);

  console.log("\n=== control: two different chunks from the same material ===");
  const pairRow = await prisma.$queryRaw<Array<{ score: number }>>`
    SELECT 1 - (a.embedding <=> b.embedding) AS score
      FROM "Chunk" a
      JOIN "Chunk" b ON b."materialId" = a."materialId" AND b.ord = a.ord + 1
     WHERE a."materialId" = ${material.id}
     ORDER BY a.ord
     LIMIT 1
  `;
  console.log("cross-chunk similarity:", pairRow[0]?.score);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
