# AI Study Companion<img width="1536" height="1024" alt="Thumbnail_Image" src="https://github.com/user-attachments/assets/5ffcefa2-3f96-40af-93c2-d1f30a45a1e0" />

<p align="center">
  <img src="./Thumbnail_Image.png" alt="AI Study Companion" width="100%">
</p>

<p align="center">
  Your AI-powered learning partner for smarter, faster, and deeper learning.
</p>
# AI Study Companion

A persistent, contextual, measurable AI learning companion — not a chatbot.

The system continuously answers three questions:

- **What am I learning?** — Spaces, Projects, goals, materials, conversations, concepts
- **How well am I learning it?** — quizzes, assessments, mistakes, Tutor interactions, mastery
- **What should I do next?** — growth analysis, weakness detection, goals, recommendations

> **Status:** Phases 1–9 complete. Foundation and data model, revocable sessions with
> project-level isolation, Spaces / Projects with their dashboards, the AI engineering
> layer, document processing (upload → background pipeline → chunked, embedded,
> searchable knowledge with a durable job queue), grounded tutoring (project-scoped
> retrieval, an evidence gate, streamed answers with citations, persisted conversations),
> adaptive assessment (concept selection by mastery, generated MCQs and open-ended
> questions, deterministic and rubric grading, mastery from evidence), growth
> (improving/stable/needs-attention classification, generated recommendations, and a
> curated `LearningContext`), and analytics & admin (project and global analytics, a
> filterable activity feed, AI usage and evaluation views, background-processing health,
> and per-user journey inspection), and hardening (rate limits on every model-billing
> endpoint, request timeouts, error and loading boundaries, deployment artifacts and a
> runbook). The full plan is in
> [`architecture.md`](./architecture.md#15-phased-build-plan).

**Demonstrate the whole loop in one command:**

```bash
npm run diag:loop    # space → project → material → Tutor → quiz → mastery → recommendations → analytics
```

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Backend | Next.js Route Handlers + Server Actions, Zod validation |
| Database | PostgreSQL 16 + pgvector |
| ORM | Prisma |
| Auth | Server-side sessions, httpOnly cookies, bcrypt |
| AI | Groq for generation + a local embedding model, behind one provider abstraction (OpenAI and a deterministic mock are also supported) |
| Background jobs | DB-backed queue + dedicated worker (`FOR UPDATE SKIP LOCKED`) |
| Testing | Vitest (unit + integration against a real Postgres and a deterministic mock provider) |

Full rationale for each choice is in [`architecture.md`](./architecture.md#3-technology-stack-with-justification).

---

## Getting started

### Prerequisites

- Node.js 20+ (22 LTS recommended)
- Docker (for PostgreSQL with pgvector)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Start PostgreSQL (pgvector-enabled)
npm run db:up        # docker compose up -d db

# 4. Apply the schema and seed demo users
npm run db:migrate
npm run db:seed

# 5. Run the app
npm run dev          # http://localhost:3000
```

The background worker is a separate process and is required for document processing and
learning workflows:

```bash
npm run worker
```

### Seeded accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.com` | `admin12345` |
| Learner | `learner@example.com` | `learner12345` |

These are development credentials from `.env.example`. Change them for any shared deployment.

---

## Providers

Generation and embeddings are configured **separately**, because no single provider does both —
Groq serves models but has no embeddings API.

| Role | Setting | Options |
| --- | --- | --- |
| Generation | `AI_PROVIDER` | `groq` (default), `openai`, `mock` |
| Embeddings | `AI_EMBED_PROVIDER` | `local` (default), `openai`, `mock` |

- **Groq** — set `GROQ_API_KEY`. Models are routed per feature via `AI_MODEL_*`, all defaulting
  to `openai/gpt-oss-120b`. Groq speaks the OpenAI wire protocol, so it reuses the same provider.
- **Local embeddings** — a small sentence-transformer (`Xenova/all-MiniLM-L6-v2`, 384 dimensions)
  runs in-process through ONNX Runtime. No key and no per-query cost; the model downloads once on
  first use.
- **`mock`** — deterministic output with no key and no network, for tests and offline development.
  Its embeddings are **not semantic**, so retrieval matches nothing and the Tutor refuses every
  question. It is deliberately not usable for a real RAG demonstration.

Changing `AI_EMBED_MODEL` changes the vector width, which needs a migration and then
`npm run reembed`. `npm run diag:provider` reports whether the configured providers are actually
reachable, and `npm run diag:retrieval -- "question"` shows the raw similarity scores.

---

## The AI layer

Nothing in the application talks to a model directly. Everything goes through
`lib/ai/index.ts`, which owns four concerns so no feature has to remember them:

| Concern | Where |
| --- | --- |
| Provider selection (`mock` / `openai` / `groq`, plus `local` embeddings) | `lib/ai/providers/` |
| Per-feature model routing | `modelForFeature()` — `AI_MODEL_TUTOR`, `AI_MODEL_EXTRACT`, … |
| Cost, latency, token, failure recording | `lib/ai/telemetry.ts` → one `AiRequest` row per call |
| Prompt-injection defence | `lib/ai/prompts.ts` |

**Structured output is validated, never trusted.** Provider-side schema enforcement is a request,
not a guarantee, so every structured response is re-parsed through its Zod schema before it can be
reached by the database. Output that fails validation raises `AiInvalidOutputError` rather than
being partially repaired.

**Materials are data, never instructions.** Document text and user messages are fenced in a
labelled `<untrusted_document>` block that cannot be closed from inside, and the system prompt
states that the block is reference material only. Apparent injection attempts are logged as
signals rather than blocked — a pattern filter would also reject legitimate material *about*
prompt injection.

**One constraint worth knowing** before adding a structured-output schema: it must not contain
value-changing transforms such as `.trim()` or `.toLowerCase()`. Strict structured outputs derive
a JSON Schema from the Zod schema, and transforms cannot be represented there — the provider
rejects the whole request. Normalise the validated result afterwards instead. A unit test enforces
this for every registered schema.

Every call is recorded — including failures, which are as informative as slow successes:

```bash
npx prisma studio   # inspect the AiRequest table
```

---

## Assessment

A quiz is adaptive in two independent ways, and neither of them flips difficulty on
whether the last answer was right — the naive rule the PRD forbids.

**Which concepts are asked about** is decided by a pure, unit-tested policy
(`lib/learning/selection.ts`) ranking
`weakness × importance × neglect × mistake history`. A concept practised moments ago is
deprioritised but never starved; a concept with repeated recent mistakes is pushed
forward. When there are fewer concepts than questions, the ranking is cycled so the
weakest come up twice rather than the quiz being silently short.

**How hard each question is** follows the learner's mastery estimate:
`difficulty = clamp(0.25 + 0.6 × mastery, 0.15, 0.9)`.

Questions are generated one per call, constrained to the chosen concept and grounded in
that concept's retrieved evidence, so a concept the material does not cover is skipped
rather than turned into a fabricated question.

Grading has two paths, and only one of them costs anything:

| Type | Grading | Model call |
| --- | --- | --- |
| Multiple choice | String comparison against the answer key | **None** |
| Open-ended | Rubric: understanding, accuracy, relevance → feedback naming what is understood and what is missing | One call |

Every answer appends `ConceptEvidence` and recomputes `Concept.mastery` in the same
transaction, so the estimate can never drift from the evidence behind it. `mastery` is a
recency-weighted mean (half-life 14 days) over the most recent observations.

The answer key never leaves the server while a question is unanswered — the API omits
`correctAnswer` until an answer exists.

`npm run diag:quiz -- "<project name>"` runs the whole flow against the configured
providers and prints the chosen concepts, difficulties, feedback, and resulting mastery.

---

## Growth and recommendations

**Growth is classified from the time series, not from a single score** (`lib/learning/growth.ts`):
fewer than two observations is reported as *stable* rather than claimed as a trend; otherwise
`delta = mastery(recent half) − mastery(earlier half)` decides *improving* or *needs attention*,
and a flat concept that sits below 40% is *needs attention* too — holding steady at 20% is not
success.

**Recommendations are generated, and the heuristic is the floor.** `recommend.generate` feeds the
learner's real state (mastery, band, evidence counts, assessment history, known weaknesses) to the
model, and replaces the project's open recommendations in one transaction — so a retried job cannot
accumulate duplicates. The dashboard's next action is the top open recommendation when there is one,
and otherwise `computeNextStep`, a deterministic rule engine. The card always says which it is:

| Source | Shown as |
| --- | --- |
| `recommendation` | "Generated from your recent results — <the reason it gave>" |
| `heuristic` | "From your current progress — based on your …" |

**`LearningContext` is curated, never a transcript** (§6.3). Goals, strengths, weaknesses and
repeated mistakes are derived from the same evidence the Growth view reads; only the `tutorSummary`
is model-written, from the latest thread. The slice is then fed back into the Tutor prompt (§7.2),
so the curation is actually used rather than merely stored.

Job chain on quiz completion:

```
quiz.evaluate → recompute mastery → recommend.generate
                                  → context.refresh
mastery.update → recompute mastery → refresh LearningContext
```

`npm run diag:growth -- "<project name>"` prints each concept's band and delta, the generated
recommendations with their reasons, the rebuilt context, and the next action the dashboard would
state.

---

## Analytics and admin

**Project analytics are owner-scoped; global analytics and everything under `/api/admin/*` are
admin-only.** The check lives in the service (`requireAdmin`), not in the route, so a new route
cannot forget it — the same discipline project-scoped reads apply with ownership asserts.

| View | Shows |
| --- | --- |
| Project → Analytics | activity heatmap, concept mastery radar, recent scores, AI calls by feature |
| `/admin` | instance totals, background-processing counts, system health, latest evaluation |
| `/admin/users` → a user | **the journey**: activity → assessment → mastery → AI usage |
| `/admin/activity` | the feed, filtered by user, project, type and time range |
| `/admin/ai` | usage by feature and model, recent failures, the latest evaluation's checks |
| `/admin/jobs` | queue counts, dead letters with their error, and a retry action |

Charts are server-rendered SVG (`components/charts/`) — a heatmap is a grid of rectangles and a
radar is a polygon, so `recharts` stays out of the bundle and out of the client.

### Evaluation

`npm run eval` provisions a fixed fixture project (the same inputs every run) and executes §10.5's
four suites through the `eval.run` job:

| Suite | Checks |
| --- | --- |
| Tutor | citations resolve to the project's own material; an out-of-scope question is refused with no answer streamed; **model-graded groundedness** |
| Retrieval | the query's own passage ranks first; every hit belongs to the project; every chunk's denormalized `projectId` agrees |
| Assessment | a quiz is generated; the answer key is one of the options; difficulty follows the concept's mastery |
| Recommendations | at least one is produced; every one states a reason; priorities are in range; **model-graded actionability** |

The report is stored as that job's result and surfaced in `/admin/ai`. Checks come in two kinds, and
the distinction matters: **assertions** are pass/fail requirements and decide the run; **metrics** are
model-graded scores, recorded and shown with their evidence, but they cannot fail the run on their own
— the same criterion scored 0.30, 0.85 and 1.00 across three runs of an unchanged system, so a noisy
grader must not be able to turn the harness red. The process exits non-zero if any assertion fails.

---

## Troubleshooting

**`Module parse failed: Unexpected character '@'` in `app/globals.css`**

`next dev` is running with `NODE_ENV=production` inherited from your shell. Next.js then builds its
production webpack pipeline, which does not wire up the development CSS loader chain, so
`globals.css` gets parsed as JavaScript. Next.js logs a related warning:
*"You are using a non-standard NODE_ENV value in your environment."*

The `dev`, `build`, and `start` scripts pin `NODE_ENV` via `cross-env`, so `npm run dev` is
unaffected. If you invoke `npx next dev` directly, unset the variable first:

```powershell
Remove-Item Env:NODE_ENV   # PowerShell
```

**`npm install` does not install TypeScript, ESLint, or Vitest**

Some shells export `NODE_ENV=production` globally, which makes npm omit `devDependencies`. Install
dev dependencies explicitly:

```bash
npm install --include=dev
```

This also applies when **adding** a package: `npm install some-pkg` re-resolves the tree and will
prune the dev dependencies along with it. Add `--include=dev` to that command too, or you will
silently lose TypeScript, ESLint, and Vitest.

**Database authentication fails / `P1000`**

A native PostgreSQL service may already own port 5432. This project publishes its container on
**5433** for that reason — confirm your `DATABASE_URL` uses `localhost:5433`, and check with:

```bash
netstat -ano | findstr ":5433"
```

**Intermittent `P1001: Can't reach database server`**

Docker Desktop's port forwarding on Windows occasionally refuses or drops a connection, including
mid-run. `lib/db.ts` therefore retries the error codes that mean the statement never reached the
server (`P1001`, `P1002`), up to three times with backoff. `P1017` is deliberately *not* retried:
that one can occur after a statement was accepted, where a blind retry could repeat a write.

You will still see `prisma:error` lines in logs for recovered attempts — Prisma logs the original
failure before the retry succeeds.

The test suite is sensitive to machine load, so favour running it when the dev servers are not
compiling. Two further settings keep it stable: `fileParallelism: false` (files share one database)
and `singleFork: true` (one worker, so one Prisma query-engine process and connection pool for the
whole suite instead of one per file).

---

## Document processing

Upload a PDF from a Project's Materials page and it is processed by a **separate worker
process** — never inside the request. You can close the browser; the work continues.

```
Upload → stored → Material(QUEUED) → job enqueued
   → worker claims the job
   → QUEUED → PROCESSING → extract text per page → OCR any page with no text layer
   → chunk (page-scoped, overlapping) → embed → extract concepts
   → READY  (or FAILED with a reason, retried, then dead-lettered)
```

**The worker is a separate process and must be running:**

```bash
npm run worker
```

Nothing is processed without it. The Materials page shows `Queued` until a worker picks
the job up.

### The job queue

Backed by the `Job` table rather than Redis, so job state is transactionally consistent
with the data a job mutates. Workers claim work with `FOR UPDATE SKIP LOCKED`, so several
can run safely and no job is handed to two of them.

| Property | How |
| --- | --- |
| Idempotency | Unique `idempotencyKey`; re-enqueueing the same work is a no-op |
| Retries | Exponential backoff with jitter, bounded by `JOB_MAX_ATTEMPTS` |
| Dead-letter | Exhausted jobs become `DEAD` and keep their `lastError` |
| Crash recovery | A job `RUNNING` past its lock timeout is reclaimed |
| Re-runnable | Chunks are replaced, not appended; concepts are upserted |

**Uploads are never trusted.** The real file type is sniffed from its contents; if that
fails, the upload is rejected rather than falling back to the browser's `Content-Type`.
A file claiming to be a PDF is rejected with `415` if it is not one.

### Known limitation: OCR

The OCR *policy* works — pages with no text layer are detected and selected for
recognition, and a document with no usable text at all fails with an actionable message
instead of reporting `READY` with zero chunks.

The OCR *execution* does not currently run in this environment: PDF.js throws
`DataCloneError: Cannot transfer object of unsupported type` from its internal
message-passing when reading embedded images (and equally when rasterising a page).
`configureUnPDF` exposes no option to control transferables, so this cannot be worked
around from application code.

OCR failure is therefore handled as **best-effort**: the error is logged and processing
continues with whatever text layer exists. This is the correct behaviour regardless —
failing an entire document because one optional stage was unavailable would discard text
that was extracted successfully. See `docs/limitations.md`.

To verify the policy and the failure handling:

```bash
npm test -- chunking documents materials-pipeline
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run worker` | Background job worker |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:migrate` | Create and apply a development migration |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Seed demo users, a Space, and a Project |
| `npm run db:studio` | Browse data with Prisma Studio |
| `npm run db:test:setup` | Create and migrate the disposable test database |
| `npm test` | Vitest suite |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run eval` | AI evaluation suites |

---

## Testing

Unit tests need nothing but Node. Integration tests need the disposable test database,
which lives in the same container under a separate database name so they can never
touch your development data:

```bash
npm run db:up          # container must be running
npm run db:test:setup  # creates + migrates ai_study_companion_test
npm test
```

`AI_PROVIDER=mock` means the suite needs no API key and no network access.

The most important test is `tests/integration/isolation.test.ts`. It asserts against a real
database — not a mock — that one user cannot read another user's Spaces or Projects, and that
the failure is a 404 rather than a 403 so resource existence cannot be probed. A mocked Prisma
would happily pass while the real ownership predicate was missing, so the test deliberately
does not mock it.

---

## Deployment

The repository ships a `Dockerfile` and a compose file with `db`, `web` and `worker` services. The
full runbook — prerequisites, migrations, secrets, reverse-proxy notes, post-deploy checks — is in
[`docs/deployment.md`](./docs/deployment.md).

```bash
docker compose build
docker compose up -d db
docker compose run --rm web npx prisma migrate deploy
docker compose up -d web worker
```

Three things to know before you try:

- **The worker is a separate process and is mandatory.** Without it uploads stay `QUEUED` forever and
  quiz evaluation never runs.
- **Storage is local-only.** `STORAGE_DRIVER=s3` is declared but unimplemented, and fails loudly
  rather than silently writing to ephemeral disk — so web and worker must share a filesystem, i.e. a
  single host with a volume. A split deployment does not work until that driver exists.
- **The seed refuses to run in production** with its documented default passwords.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`architecture.md`](./architecture.md) | Architecture, tech-stack justification, data model, runtime flows, security, phased build plan |
| [`docs/ai-usage.md`](./docs/ai-usage.md) | AI used to build the product vs. AI used by the product, with models |
| [`docs/development-prompts.md`](./docs/development-prompts.md) | The prompts the product uses, grouped by area |
| [`docs/evaluation.md`](./docs/evaluation.md) | How Tutor, retrieval, assessment and recommendation quality are evaluated |
| [`docs/deployment.md`](./docs/deployment.md) | How to run it in production, and what will stop you |
| [`docs/limitations.md`](./docs/limitations.md) | What does not work yet and why, with the upgrade path for each |

---

## Project structure

```
app/          Next.js routes (pages + API route handlers)
components/   UI components
lib/
  services/   Business logic — the only layer that touches Prisma
  ai/         Provider abstraction, features, prompts, telemetry
  rag/        Chunking, embedding, retrieval, citations
  jobs/       Queue and job handlers
  auth/       Sessions, passwords, authorization guards
prisma/       Schema, migrations, seed
scripts/      Worker and evaluation entrypoints
tests/        Unit, integration, and E2E tests
```
