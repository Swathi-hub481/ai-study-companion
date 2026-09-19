# Known Limitations

Running list, updated as phases land. Each entry states what does not work, why, and
what it would take to fix.

---

## Documents

### OCR does not execute in this environment

**Status:** the policy works; the recognition step does not run.

Pages with no usable text layer *are* detected and selected for OCR, and a document with
no extractable text at all fails with an actionable message rather than reporting `READY`
with zero chunks. What fails is the recognition itself: PDF.js throws

```
DataCloneError: Cannot transfer object of unsupported type
```

from its internal `LoopbackPort` message passing, both when reading a page's embedded
images and when rasterising a page. `unpdf`'s `configureUnPDF` only accepts a PDF.js
module resolver, so there is no option to control transferables from application code.

**Impact:** scanned or image-only PDFs cannot be made searchable. They fail with a clear
reason instead of silently producing nothing.

**Mitigation already in place:** OCR is best-effort. A failure is logged and processing
continues with the text layer, because discarding successfully extracted text over an
optional stage would be worse.

**To fix:** rasterise without PDF.js's worker path — for example a dedicated
`pdfium`/`mupdf` binding, or an external OCR service — then feed the image to Tesseract.

### Text-layer quality depends on the source PDF

Text is extracted from the PDF's text layer. Documents produced by scanning followed by
embedded-OCR (a "searchable PDF") work; documents that are pure images do not, per above.
Layout-heavy documents lose table structure — extracted text is a reading-order stream, so
a table's cells are chunked as prose.

### Chunking is fixed-size, not semantic

Chunks are token-budgeted with sentence-aligned boundaries, overlapping by
`CHUNK_OVERLAP_TOKENS`. They are deliberately page-scoped so citations stay accurate.
There is no semantic boundary detection, so a topic that changes mid-page may share a
chunk with the previous topic.

---

## Database and storage

### `pgvector` search is brute-force at prototype scale

Retrieval runs a cosine similarity scan over the rows for one Project. That is correct and
fast for the corpus sizes this prototype handles, and the `projectId` filter keeps the
candidate set small, but it is not an ANN index. Adding an `ivfflat` or `hnsw` index is the
upgrade path.

### Deleting a user orphans their stored files

Deleting a `User` cascades to their Spaces, Projects, and Materials, but the underlying
files in document storage are not removed — that cleanup lives in
`deleteMaterial`, which is not invoked by a cascade. There is no account-deletion feature
yet, so this is currently unreachable through the app.

### Chunk embeddings are written per batch, not per row

`Chunk.embedding` is an `Unsupported("vector")` column, so embeddings are attached with raw
SQL after the rows are inserted. That is one statement per 64 chunks rather than one per
chunk, but it is still a second pass; a single multi-row `INSERT` carrying the vectors
would be faster.

---

## AI layer

### Cost is estimated from a static price table

`lib/ai/pricing.ts` holds a hand-maintained table of USD per million tokens. An unpriced
model records `0` and logs a warning once. Prices change; the table is a reviewable edit,
not a feed. `openai/gpt-oss-120b` is currently unpriced, so Groq calls record a cost of `0`
even though they are billed.

### Token counts from the mock provider are estimates

The mock estimates tokens as characters ÷ 4 and flags them as estimated. Only provider
reported usage is exact.

### Structured-output schemas must avoid value-changing transforms

`.trim()` and similar cannot be expressed in the JSON Schema that strict structured outputs
are generated from, and including one makes the provider reject the whole request.
Normalisation therefore happens after validation. A unit test enforces this for every
registered schema.

---

## Tutor

### Retrieval requires a semantic embedding provider

The `mock` embedding provider produces deterministic but **non-semantic** vectors: identical
text yields an identical vector, and any two different texts are effectively orthogonal.
Measured against a real upload, the best cosine similarity for a genuine question was
**0.019**, and two *different* chunks of the same document scored **0.024** — far below
`RETRIEVAL_MIN_SCORE` (0.35). The evidence gate then refuses every question, and that refusal
is correct: there is no evidence in the vector space. `mock` exists for tests and offline
development, not for a real demonstration of retrieval.

`npm run diag:retrieval -- "your question"` prints the raw similarities and shows exactly
where the threshold falls.

### Groq provides no embeddings

Groq serves chat models but has no embeddings endpoint — `POST /embeddings` returns 404. That
is why generation and embeddings are configured separately (`AI_PROVIDER` / `AI_EMBED_PROVIDER`):
retrieval depends on the local embedding model, never on Groq.

### The local embedding model is coarser than a hosted one

`Xenova/all-MiniLM-L6-v2` produces 384-dimension vectors, against 1536 for
`text-embedding-3-small`. It is fast, free and entirely local, but its notion of similarity is
correspondingly less nuanced, and it produces **lower absolute scores** for a short query
against a long passage.

`RETRIEVAL_MIN_SCORE` is therefore **model-specific, not a universal constant**. Measured
against a real resume upload with the local model:

| | best cosine similarity |
| --- | --- |
| Relevant questions (5) | 0.416, 0.346, 0.317, 0.238, 0.159 |
| Unrelated questions (4) | 0.113, 0.090, −0.004, −0.013 |

The two sets leave a gap between 0.113 and 0.159, so the threshold is set to **0.14** — chosen
from measured separation, not tuned to make one query pass. Every unrelated question still
falls below it. Recalibrate with `npm run diag:retrieval -- "question"` whenever
`AI_EMBED_MODEL` changes; substituting a larger local model also changes the vector width,
which needs a migration and `npm run reembed`.

### Reasoning models can return no text at all

`openai/gpt-oss-120b` is a reasoning model: it spends part of its completion budget on hidden
reasoning before emitting an answer. A request whose budget is consumed by reasoning returns
**empty content**, which the provider correctly rejects with `AiError`. The application does not
send `max_tokens`, so the provider's default applies; a future change that caps `max_tokens` too
low would resurface as intermittent empty-response failures. Streaming is unaffected — reasoning
deltas arrive in a separate field and are ignored.

### Changing the embedding model requires re-embedding every material

A vector is only meaningful relative to the model that produced it. Changing `AI_PROVIDER`,
`AI_EMBED_MODEL`, or `AI_EMBED_DIMENSIONS` silently invalidates every stored vector, and
retrieval matches nothing until they are recomputed with `npx tsx scripts/reembed-materials.ts`.

Related: `replaceChunks` deletes a material's chunks before embedding them, so a re-embed
that fails part-way — for example on a provider quota error — leaves that material `FAILED`
with embedding-less chunks. Re-running with a working provider repairs it.

### `Conversation.summary` is stored but never generated

The column exists so continuity does not require re-sending the whole transcript, and the
Tutor prompt uses it when present, but nothing writes it yet. Older turns simply fall out
of the `CONVERSATION_WINDOW_TURNS` window. Rolling summarisation belongs with the curated
`LearningContext` work.

### A failed stream leaves no partial answer

If the model call fails mid-stream the partial text is discarded and no assistant `Message`
is persisted; the failure is recorded on the `AiRequest` row instead. The learner sees an
error and can retry.

### There is no way to stop a generation

Once an answer starts streaming there is no cancel control. The request runs to completion,
or the tab is closed — at which point telemetry still records the partial stream.

### Citations resolve to the Materials page, not the exact passage

There is no per-document viewer yet, so a citation chip leads to the Project's Materials
page rather than to the cited page itself.

---

## Assessment

### Mastery is a heuristic, not a measurement

`Concept.mastery` is a recency-weighted mean of quiz evidence (half-life 14 days, most
recent 20 observations). It is a defensible summary, not a psychometric estimate: a lucky
multiple-choice guess moves it exactly as much as a well-reasoned written answer, because
both carry weight 1 for the question's own concept. A future revision would weight evidence
by how much information the question type actually carries — a written answer demonstrates
more than selecting one of four options.

### Distractor quality belongs to the model

The prompt requires one correct option and three that are plausible-but-wrong, and
generation is rejected (retried once, then failed) if the answer key does not match an
option. But "plausible" is a judgement the model makes, and distractors are the weakest
part of a generated multiple-choice question — worth reading before trusting a quiz.

### Reasoning models make generation slow and non-repetitive

`openai/gpt-oss-120b` spends part of its budget on hidden reasoning, so question wording
varies between runs and each question costs a few seconds. A six-question quiz is six
sequential generation calls. A malformed question is retried once, which doubles that
question's latency.

### Evaluation is mastery-only

`quiz.evaluate` recomputes mastery for the concepts a quiz touched. Weakness detection,
growth classification, and recommendation generation are Phase 8 and extend the same
handler.

### Attribution from written answers is name-matched

Open-ended grading returns concept *names*, matched to the project's concepts
case-insensitively. A name the model invents, or one that differs from the stored concept
name, is recorded on the answer but produces no evidence — it never creates a concept, so a
creative grader cannot pollute the knowledge map.

---

## Growth, recommendations and context

### Growth needs more than one data point

A concept with a single observation is reported as *stable*, which is honest but uninformative.
With two observations the "trend" is still thin — one bad answer moves the band. The delta is shown
beside the band precisely so a learner can judge it, but the classification is a heuristic over
sparse evidence, not a measurement.

### Recommendations cost two extra model calls per quiz

`quiz.evaluate` queues `recommend.generate` and `context.refresh`, so completing a quiz triggers a
second wave of generation. Neither blocks the response, and both are retryable, but neither is free,
and on a reasoning model each takes seconds.

### `LearningContext.preferences` is never populated

There is no signal in the product for how a learner prefers to be taught — no settings, no feedback
mechanism. The field is deliberately left untouched rather than inferred from behaviour that does
not actually demonstrate a preference.

### Recommendation status cannot be changed from the UI yet

`Recommendation.status` supports `DONE` and `DISMISSED`, and resolved rows survive regeneration, but
nothing in the interface sets them. Because regeneration replaces the open set, an unactioned
suggestion simply disappears the next time it runs rather than being visibly superseded.

### The tutor summary needs a conversation

`context.refresh` writes `tutorSummary` only when the project has a tutoring thread; otherwise the
previous value is kept and no model call is made. A project used only for quizzes therefore keeps an
empty summary — honest, but it means the Tutor gets no curated notes for that project.

### Charts are hand-rolled for now

The mastery trend is an inline SVG sparkline. `recharts` (§3.3) is deferred to the analytics phase,
where the activity heatmap and concept radar make a charting library worth its weight.

### Generated prose carries no hard length cap

Strict structured outputs are enforced server-side, so a `maxLength` the model overshoots is
rejected outright rather than clipped — a 732-character summary against a 600-character cap failed
the entire call during acceptance testing. Prose fields therefore declare no schema cap: length is
asked for in the description and enforced by truncation where the value is persisted
(`LearningContext.tutorSummary`, recommendation text, grading feedback). Truncation is imperfect but
it is local and predictable.

The one exception is a generated question's `prompt`, where truncation would corrupt the artefact
itself. An over-long question still fails the call; a retry is the only recovery.

---

## Analytics and admin

### Evaluation results live in the job table

A run is stored as the `eval.run` job's result, and the admin view reads the most recent completed
one. Only the latest is cheap to read, history is bounded by queue retention, and there is **no
committed baseline to diff against** — which §10.5 asks for. Baseline diffing is deliberate Phase 10
work; until then a regression is visible in the report itself, not against a stored expectation.

### Model-graded evaluation is noisy, so it does not gate the run

Checks are split into **assertions** (pass/fail requirements — "the answer key is one of the
options") and **metrics** (model-graded scores — "is this answer grounded?"). Only assertions decide
whether a run passed. That is measured, not assumed: one criterion scored **0.30, 0.85 and 1.00**
across three runs of an unchanged system, because a model grading a model is a noisy instrument.
Metrics are recorded with their evidence and flagged when below their floor, but until there is a
baseline to diff against, gating on them would make `npm run eval` fail at random.

The corollary is that a genuine quality *regression* in a metric will not fail the run — it appears
as a lower score in the report, which someone has to look at.

### One evaluation criterion was corrected, not loosened

The Tutor's groundedness metric originally demanded that *every* factual claim be supported by the
reference material. It scored 0.40 on an answer that cited the right page and merely explained what
it had read — punishing exposition rather than detecting invention. The criterion now matches the
Tutor's actual contract (§7.2): claims come from the material, nothing contradicts it, and outside
knowledge is not presented as though it came from it. The strict version is preserved in the commit
history rather than deleted, so the change can be reviewed.

### Analytics are windowed, not rolled up

Activity, AI usage and the heatmaps cover a fixed window (30 days by default, capped at 365 in the
admin AI view). There is no rollup table, so asking for a longer horizon means a wider query rather
than a cheaper one. Every aggregation is still grouped in the database or explicitly windowed — an
unbounded scan is never on the request path.

### System health is per-process

`/api/admin/health` reports the memory and uptime of the process that answered the request, and
`staleRunning` counts jobs `RUNNING` beyond the configured lock timeout. Behind more than one
instance each reports only itself, and there is **no worker heartbeat**: a worker that has died
outright looks the same as a worker with nothing to do. Queue depth and stale locks are the only
signal.

### Admin retry re-queues; it does not repair

Retrying a dead-lettered job resets its attempts and puts it back on the queue. Handlers are
idempotent, so this is safe, but a job that failed for a permanent reason — a corrupt document, a
missing record — will simply fail again. The retry is a recovery tool, not a fix.

### Cost is still zero for the current model

`openai/gpt-oss-120b` has no price entry, so the AI-usage views show real token counts, latencies and
failure rates but a cost of `$0`. The figures are honest, just incomplete.

---

## Hardening and deployment

### Timeouts cover the boundaries, not everything

The client abandons a request after 20 seconds, and the Tutor's SSE stream is capped at 55 seconds
with a 30-second idle guard. The model SDK has its own timeout. What is **not** timed out:

- **Local embeddings.** They are in-process ONNX and the first call downloads the model — 65 seconds
  was observed on a cold cache. A timeout there would break the first run of every deployment, which
  is worse than a slow first call.
- **Database queries.** A pathological query would run until Postgres or the pool gives up.

### Per-process rate limits

Rate limits now cover every endpoint that costs money — login, register, upload, Tutor, quiz start,
answer, complete, and recommendation refresh — but they are still counted in memory. With N web
instances the effective limit is N×. Redis behind the same signature is the upgrade; see also the
Platform section above.

### The container image carries development dependencies

The runtime stage copies the full `node_modules` because the worker runs TypeScript through `tsx` and
`prisma migrate deploy` is run from the same image. That is a deliberate trade of image size for a
single reproducible artifact; a production-only install would need a compiled worker entrypoint.

### No browser tests

Architecture §13 lists a Playwright suite walking the loop through the UI. There is none: the README
previously advertised it and no longer does. What exists instead is `npm run diag:loop`, which drives
the same services the routes call and asserts each stage. It covers the product's behaviour but not
its client-side JavaScript, so a broken component would not be caught by it.

### Two accounts with known passwords exist by design

`npm run db:seed` creates a documented administrator, and `npm run eval` creates
`eval-fixture@example.com` with a fixed password. The seed now refuses to run in production without
real credentials; the evaluation fixture has no such guard, which is acceptable only because running
`npm run eval` against a public deployment is not something anyone should do.

### Deployment is documented, not performed

The image builds and `docker compose config` validates, but nothing here has been deployed to a
public URL: that needs hosting accounts, a managed Postgres and a domain. `docs/deployment.md` is the
checklist, and the storage constraint above is the thing most likely to bite.

---

## Platform

### Rate limiting is per-process

The limiter in `lib/rate-limit.ts` counts in memory, so with several server instances each
gets its own budget. It is abuse mitigation, not a security boundary. A Redis-backed
counter behind the same signature is the upgrade.

### `x-forwarded-for` is trusted for client identity

Correct behind a proxy that overwrites the header; spoofable otherwise, which is the same
limitation as the rate limiter above.

### The local storage driver is not suitable for multiple instances

`STORAGE_DRIVER=local` writes to the container's filesystem. A deployment with more than
one instance needs shared storage; `STORAGE_DRIVER=s3` exists as a configuration value but
the provider is deliberately unimplemented, and fails loudly rather than silently writing
to ephemeral disk.

---

## Development environment

### The test suite is sensitive to machine load

Integration tests run against a real PostgreSQL in Docker. Docker Desktop's port forwarding
on Windows intermittently refuses or drops a connection (`P1001`); `lib/db.ts` retries
those. The suite also uses `singleFork` and `fileParallelism: false`. Run it when the dev
servers are not compiling.
