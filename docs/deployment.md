# Deployment

How to run this in production, and what will stop you. Everything here has been verified locally as
far as it can be without a host; the parts that cannot be verified are called out.

---

## Read this first: the storage constraint

`STORAGE_DRIVER=local` writes uploaded documents to the filesystem. That means **the web process and
the worker must share a filesystem**, which in practice means a single host with a shared volume.

`STORAGE_DRIVER=s3` exists as a configuration value and **is not implemented** — setting it throws
`STORAGE_DRIVER=s3 is not implemented yet` rather than silently writing to ephemeral disk. So:

- **Single host with a shared volume** (the compose file in this repository): works today.
- **Web and worker on different machines** (e.g. Vercel + Railway): **does not work today.** A
  document uploaded to the web process would not be readable by the worker. Implementing the S3
  driver is the prerequisite, and it is listed in [`limitations.md`](./limitations.md).

This is the honest answer to "can it be deployed to a public URL": yes, on one host; not yet as a
split deployment.

---

## What you need

| Requirement | Notes |
| --- | --- |
| PostgreSQL 16 **with pgvector** | The schema declares `extensions = [vector]` and `Chunk.embedding` is `vector(384)`. Neon, Supabase and RDS all offer it. |
| A host for the web process | Any container host, or `next start` behind a reverse proxy. |
| A host for the worker | **Required.** Documents are processed out of band; without it uploads stay `QUEUED` forever. |
| `AUTH_SECRET` | ≥16 characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| An AI provider | `GROQ_API_KEY`, or `AI_PROVIDER=openai` with `OPENAI_API_KEY`. |
| A volume | For uploaded documents **and** the embedding model cache. |

Secrets belong in the platform's environment configuration. `.env` is gitignored and `.dockerignore`
excludes it, so no environment file reaches an image.

---

## Option A — one host, Docker Compose (supported today)

The repository ships a `Dockerfile` and a compose file with `db`, `web` and `worker`.

```bash
# 1. Build and start the database.
docker compose build
docker compose up -d db

# 2. Apply migrations. Never `migrate dev` against a deployed database — it can reset it.
docker compose run --rm web npx prisma migrate deploy

# 3. Start both processes. The worker is a separate service on purpose.
docker compose up -d web worker
```

`AUTH_SECRET` is required and has no default; compose refuses to start without it:

```bash
AUTH_SECRET=… AI_PROVIDER=groq GROQ_API_KEY=… docker compose up -d web worker
```

Optionally seed a demo account — see "Seeding" below, and note that it will refuse unless real
passwords are supplied.

### Behind a reverse proxy

- Terminate TLS at the proxy and forward to port 3000.
- **Do not buffer responses on `/api/tutor`.** It is a Server-Sent Events stream; a proxy that buffers
  turns a streaming answer into a long silence. The route already sends `X-Accel-Buffering: no`, which
  nginx honours.
- Set `APP_URL` to the public origin. Session cookies are `Secure` in production, so plain HTTP will
  not keep you signed in.

---

## Option B — managed Postgres, one host for the app

If the database is managed (Neon, Supabase, RDS):

1. Point `DATABASE_URL` at it, with `?schema=public`.
2. Ensure the `vector` extension can be created — `prisma migrate deploy` runs
   `CREATE EXTENSION IF NOT EXISTS "vector"`, which needs sufficient privilege.
3. Run migrations as a release step, then start web and worker **on the same host**, sharing a
   volume, for the storage reason above.

---

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres with pgvector |
| `AUTH_SECRET` | yes | ≥16 characters |
| `APP_URL` | recommended | Public origin; drives `Secure` cookies |
| `AI_PROVIDER` | yes | `groq` \| `openai` \| `mock` |
| `GROQ_API_KEY` / `OPENAI_API_KEY` | per provider | `mock` needs neither, but cannot ground answers |
| `AI_EMBED_PROVIDER` | recommended | `local` (default) \| `openai` \| `mock` |
| `AI_EMBED_DIMENSIONS` | **must match the column** | `384`. Changing it requires a migration and `npm run reembed` |
| `STORAGE_DRIVER` | yes | `local` only — `s3` throws |
| `STORAGE_LOCAL_DIR` | with local storage | Shared by web and worker |
| `LOG_LEVEL` | no | `info` by default; JSON in production |
| `JOB_*` | no | Poll interval, backoff, lock timeout, max attempts |

---

## Migrations

```bash
docker compose run --rm web npx prisma migrate deploy
```

Forward-only, idempotent, safe to re-run. Run it once per release, before the new web process starts.
Do not run `prisma migrate dev` (interactive, and it can reset a database) or `prisma migrate reset`
(destructive) against anything you care about.

## Seeding

`npm run db:seed` creates an administrator whose password is **documented in the README**. It
therefore refuses to run when `NODE_ENV=production` unless real passwords are supplied:

```bash
SEED_ADMIN_PASSWORD=… SEED_USER_PASSWORD=… docker compose run --rm web npm run db:seed
```

It will also refuse if you are locally running with an exported `NODE_ENV=production` — a shell quirk
this project's docs warn about elsewhere. The error message says exactly what to do.

## The embedding model

With `AI_EMBED_PROVIDER=local`, the sentence-transformer is downloaded on first use (~23 MB) by
**both** processes. Point its cache at the shared volume (`HF_HOME` / `TRANSFORMERS_CACHE` in the
compose file) so a container rebuild does not re-download it. If a future version of the library
changes its cache variable, the worst case is a re-download, not a failure.

---

## Post-deploy verification

In order, stopping at the first failure:

1. `GET /api/health` → `200` and `checks.database: "up"`.
2. `GET /api/admin/health` as an administrator → job counts, and the configuration the process
   actually resolved (`aiProvider`, `embedModel`, `storageDriver`).
3. Sign in, create a Space and a Project.
4. Upload a PDF → status goes `QUEUED` → `PROCESSING` → `READY`. **If it stays `QUEUED`, the worker
   is not running.**
5. Ask the Tutor a question the document answers → a streamed answer with citations.
6. Ask something unrelated → an explicit insufficient-evidence refusal.
7. Take a quiz → answers graded with feedback; the dashboard's next action updates.
8. `/admin/jobs` → no unexpected `DEAD` jobs.
9. Optionally `docker compose run --rm web npm run eval` → the evaluation suites pass.

## Operating notes

- **Dead letters are visible, not discarded.** `/admin/jobs` lists failed and dead jobs with their
  `lastError`, and each can be retried. A job that failed for a permanent reason will simply fail
  again — the retry is recovery, not repair.
- **Rate limits are per-process.** With more than one web instance the effective limits multiply.
  They are abuse mitigation, not a security boundary.
- **Logs are structured JSON in production**, one line per event, with the job or AI call in context.
- **Rollback** is redeploying the previous image. Migrations are forward-only, so roll back the
  application only if the migration was additive.

---

## What is not verified here

The image builds and `docker compose config` validates, but **nothing in this repository has been
deployed to a public URL**: that needs hosting accounts, a managed Postgres and a domain, none of
which belong in a coding session. Treat the checklist above as the thing to run once you have them.
