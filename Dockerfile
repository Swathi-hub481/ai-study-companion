# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# One image for both processes.
#
# The web server and the background worker run the same code, so they are built once and
# the worker simply overrides the command (see docker-compose.yml). Development
# dependencies are kept in the runtime stage on purpose: the worker runs TypeScript
# through `tsx`, and `prisma migrate deploy` is run from this same image during a deploy.
# That trades image size for a single, reproducible artifact.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Only the manifests, so a source change does not invalidate the dependency layer.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` imports every route module, and `lib/db.ts` validates configuration the
# moment it is imported — so a build with no environment fails for reasons that have
# nothing to do with the build. These are build-time placeholders only; real values are
# supplied at runtime and a typo in them is still caught on boot.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime"

# The Prisma client must exist before the build type-checks against it.
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Run unprivileged: the base image already provides a `node` user.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/lib ./lib
# The worker runs TypeScript through `tsx`, which resolves the `@/…` path aliases from here.
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000

CMD ["npm", "run", "start"]
