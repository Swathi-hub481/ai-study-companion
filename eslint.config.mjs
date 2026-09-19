import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Alternate build output directories. `next.config.ts` reads NEXT_DIST_DIR so a
      // production build can be verified without clobbering a running dev server's
      // `.next`, and `tsconfig.json` includes their generated types — so they are
      // expected to exist and must never be linted.
      ".next-verify/**",
      ".next-build/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    /*
     * Architectural boundary: presentational components must not reach into server
     * services, the database, or the AI/job layers.
     *
     * Scoped to components/ deliberately. Files under app/ are Server Components by
     * default and are *supposed* to call services; restricting them here would flag
     * correct code. The client/server split inside app/ is enforced instead by
     * `"use client"` plus the fact that services import Prisma, which cannot be
     * bundled for the browser.
     */
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/db",
                "@/lib/ai/*",
                "@/lib/rag/*",
                "@/lib/jobs/*",
                "@/lib/services/*",
              ],
              message:
                "Server-only module. Components should receive data as props; import shared types from a domain module instead (e.g. @/lib/learning/*).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
