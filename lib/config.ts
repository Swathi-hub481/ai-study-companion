import { z } from "zod";

/**
 * Centralised, validated configuration.
 *
 * Read through `env` (a lazy proxy) rather than `process.env` so that:
 *  - a typo in a variable name is a startup error, not a silent `undefined`;
 *  - `next build` does not fail on a machine that has not created `.env` yet.
 *
 * Deliberately does NOT import "server-only": the background worker imports this
 * module outside of the Next.js runtime.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Generation and embeddings are configured separately, because no single provider
  // does both: Groq serves models but has no embeddings API, so vectors come from a
  // local model instead.
  AI_PROVIDER: z.enum(["mock", "openai", "groq"]).default("mock"),
  AI_EMBED_PROVIDER: z.enum(["mock", "openai", "local"]).default("local"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),

  AI_MODEL_TUTOR: z.string().default("openai/gpt-oss-120b"),
  AI_MODEL_QUIZ: z.string().default("openai/gpt-oss-120b"),
  AI_MODEL_GRADE: z.string().default("openai/gpt-oss-120b"),
  AI_MODEL_EXTRACT: z.string().default("openai/gpt-oss-120b"),
  AI_MODEL_RECOMMEND: z.string().default("openai/gpt-oss-120b"),
  AI_EMBED_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  AI_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(384),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(6),
  // Model-specific: 0.14 is calibrated for the default local 384-dimension embeddings.
  // Recalibrate with `npm run diag:retrieval` if the embedding model changes.
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.14),
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(500),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(80),
  CONVERSATION_WINDOW_TURNS: z.coerce.number().int().positive().default(6),

  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  OCR_ENABLED: booleanish.default(true),
  OCR_MIN_CHARS_PER_PAGE: z.coerce.number().int().nonnegative().default(120),

  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_POLL_MS: z.coerce.number().int().positive().default(2_000),
  JOB_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(5_000),
  JOB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Defaults applied when a variable is absent, so a minimal `.env` still runs. */
const DEFAULTS: Partial<Record<keyof Env, unknown>> = {
  AI_MODEL_TUTOR: "openai/gpt-oss-120b",
  AI_MODEL_QUIZ: "openai/gpt-oss-120b",
  AI_MODEL_GRADE: "openai/gpt-oss-120b",
  AI_MODEL_EXTRACT: "openai/gpt-oss-120b",
  AI_MODEL_RECOMMEND: "openai/gpt-oss-120b",
  AI_EMBED_MODEL: "Xenova/all-MiniLM-L6-v2",
};

/**
 * Reads process.env, dropping blank values so that an empty assignment in `.env`
 * (e.g. `OPENAI_API_KEY=`) falls through to the schema default instead of being
 * treated as a real, invalid value.
 */
function readRaw(): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || value === "") continue;
    raw[key] = value;
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (raw[key] === undefined && value !== undefined) raw[key] = String(value);
  }

  return raw;
}

let cached: Env | null = null;

function loadEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(readRaw());

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        `Copy .env.example to .env and fill in the required values.`,
    );
  }

  cached = parsed.data;
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, property: string | symbol) {
    if (typeof property === "symbol") return undefined;
    return loadEnv()[property as keyof Env];
  },
  has(_target, property: string | symbol) {
    return typeof property === "string" && property in loadEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(loadEnv());
  },
  getOwnPropertyDescriptor(_target, property: string | symbol) {
    if (typeof property !== "string") return undefined;
    return { enumerable: true, configurable: true, value: loadEnv()[property as keyof Env] };
  },
});

/** Forces validation early — call from entrypoints for a fast, clear failure. */
export function assertConfig(): void {
  loadEnv();
}

export const isProduction = () => env.NODE_ENV === "production";
export const isTest = () => env.NODE_ENV === "test";
export const isMockAI = () => env.AI_PROVIDER === "mock";

/** Test helper: clears the memoised config so env changes take effect. */
export function resetConfigCache(): void {
  cached = null;
}
