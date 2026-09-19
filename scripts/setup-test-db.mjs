import { spawnSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Prepares the disposable test database by applying migrations to the
 * DATABASE_URL from .env.test. Prisma creates the database itself if it does not
 * exist, so a fresh checkout needs no manual `createdb`.
 */

config({ path: ".env.test", quiet: true });

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set in .env.test");
  process.exit(1);
}

// Never print credentials, even for a local throwaway database.
const redacted = url.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@");
console.log(`Applying migrations to ${redacted}`);

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
