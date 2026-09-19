import { config } from "dotenv";

/**
 * Test bootstrap.
 *
 * `.env.test` wins over `.env` so integration tests can point at a disposable
 * database. Defaults are then applied so unit tests that never touch the network
 * or the database still run on a clean checkout with no environment at all.
 */

config({ path: ".env.test", quiet: true });
config({ path: ".env", quiet: true });

// `NODE_ENV` is typed as read-only. It must still be forced here because a shell
// that exports NODE_ENV=production would otherwise leak production behaviour into
// the test run (Vitest only sets it when it is unset).
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

process.env.LOG_LEVEL ??= "silent";
process.env.AUTH_SECRET ??= "test-auth-secret-value-0123456789";
process.env.APP_URL ??= "http://localhost:3000";
// Forced, not defaulted. The suite must never reach a real provider: an inherited or
// leaked `AI_PROVIDER=openai` would send test traffic to OpenAI — slow, billable, and
// non-deterministic. Files that deliberately exercise the real provider (against a
// local stub) set this themselves and restore it.
process.env.AI_PROVIDER = "mock";

// Same reasoning for embeddings: tests must never download a model or call an embedding
// API. The mock's vectors must also match the width of the `Chunk.embedding` column.
process.env.AI_EMBED_PROVIDER = "mock";
process.env.AI_EMBED_DIMENSIONS = "384";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5433/ai_study_companion_test?schema=public";
