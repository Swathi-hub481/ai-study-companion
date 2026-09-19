-- The embedding width follows the embedding model (AI_EMBED_MODEL / AI_EMBED_DIMENSIONS).
--
-- Retrieval moved from a hosted 1536-dimension embedding model to a local 384-dimension
-- one (Groq has no embeddings API). A vector of one width cannot be cast to another, so
-- the column is dropped and recreated rather than altered, and every existing vector is
-- recomputed afterwards with `npm run reembed`. The old vectors were meaningless for the
-- new model in any case.

ALTER TABLE "Chunk" DROP COLUMN "embedding";

ALTER TABLE "Chunk" ADD COLUMN "embedding" vector(384);
