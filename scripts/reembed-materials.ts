/**
 * Recomputes the chunk embeddings of existing materials with the configured provider.
 *
 * A vector is only meaningful relative to the model that produced it. Changing
 * `AI_PROVIDER`, `AI_EMBED_MODEL`, or `AI_EMBED_DIMENSIONS` therefore invalidates every
 * stored vector, and retrieval will silently match nothing until they are recomputed.
 * This runs the normal processing pipeline over existing materials, which re-parses,
 * re-chunks, re-embeds, and re-upserts concepts — the same idempotent path the worker
 * and the retry button use.
 *
 * Usage:
 *   npx tsx scripts/reembed-materials.ts               # every READY material
 *   npx tsx scripts/reembed-materials.ts <materialId>  # one material
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

async function main() {
  const { env } = await import("../lib/config");
  const { prisma } = await import("../lib/db");
  const { processMaterial } = await import("../lib/services/materials");

  const materialId = process.argv[2];

  console.log(
    `generation=${env.AI_PROVIDER} embeddings=${env.AI_EMBED_PROVIDER} ` +
      `model=${env.AI_EMBED_MODEL} dimensions=${env.AI_EMBED_DIMENSIONS}`,
  );

  if (env.AI_EMBED_PROVIDER === "mock") {
    console.log(
      "!! AI_EMBED_PROVIDER is 'mock'. Those embeddings are not semantic, so re-embedding " +
        "would leave retrieval unable to match real questions.",
    );
  }

  const materials = await prisma.material.findMany({
    where: materialId ? { id: materialId } : { status: "READY" },
    select: { id: true, filename: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  if (materials.length === 0) {
    console.log("No materials to re-embed.");
    return;
  }

  for (const material of materials) {
    console.log(`\nreprocessing ${material.filename} (${material.id}, ${material.status})`);

    const result = await processMaterial(material.id);

    console.log(
      `  -> pages=${result.pageCount} chunks=${result.chunkCount} concepts=${result.conceptCount}`,
    );
  }

  const dims = await prisma.$queryRaw<Array<{ dims: number; missing: bigint }>>`
    SELECT min(vector_dims(embedding))::int AS dims,
           count(*) FILTER (WHERE embedding IS NULL) AS missing
      FROM "Chunk"
  `;

  console.log(`\nchunk vectors now: dims=${dims[0]?.dims} missing=${Number(dims[0]?.missing ?? 0)}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
