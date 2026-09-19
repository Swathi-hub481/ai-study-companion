import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    // Default to the node environment (services, jobs, domain logic).
    // Component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Integration tests hit a real PostgreSQL through Docker Desktop's port proxy,
    // where a dashboard test can issue ten or more round-trips. The 5s default is
    // comfortable in isolation but not when the whole suite is running, and a timeout
    // reads as a mystery failure rather than a slow query.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Integration tests share one Postgres database; run files sequentially so
    // they cannot interleave transactions and produce flaky isolation results.
    fileParallelism: false,
    poolOptions: {
      forks: {
        // One worker for the whole suite. lib/db.ts memoises the Prisma client on
        // globalThis, so a single process means a single query-engine child process
        // and a single connection pool, instead of one per test file. Repeatedly
        // starting and tearing those down was the source of multi-second stalls.
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
