import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Overridable so a production build can be verified without overwriting the
  // `.next` directory that a running dev server is serving from.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // These packages must not be bundled:
  //  - pino / pino-pretty use worker-thread transports
  //  - @prisma/client ships a native query engine
  //  - unpdf bundles PDF.js, which expects a browser/worker environment
  //  - @napi-rs/canvas and tesseract.js load native binaries and WASM at runtime.
  //    Bundling them fails with "Module parse failed: Unexpected character" on the
  //    .node binary.
  //  - @huggingface/transformers loads onnxruntime-node, another native binary.
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "@prisma/client",
    "unpdf",
    "@napi-rs/canvas",
    "tesseract.js",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  eslint: {
    // Linting is a separate CI step; keep `next build` focused on compilation.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
