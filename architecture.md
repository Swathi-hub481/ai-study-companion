# AI Study Companion — Architecture & Implementation Plan

Version 1.0 · Target: 3–4 day prototype · Role: Full-Stack AI Engineer

---

## 1. Purpose of This Document

This is the working architecture and build plan for **AI Study Companion**, an AI-powered
learning workspace. It covers:

1. The product goals the architecture must satisfy
2. The chosen technology stack, with the justification for each choice
3. The complete tool and framework inventory
4. The high-level system design and component responsibilities
5. The data model
6. The critical runtime flows
7. Security, isolation, and AI-safety design
8. The background processing model
9. The AI engineering layer (abstraction, observability, evaluation)
10. Testing, deployment, and configuration
11. A phased, ordered build plan with acceptance criteria
12. Known simplifications and the upgrade path

---

## 2. Product Goal Summary

The product is a *persistent, contextual, measurable AI learning companion* — not a chatbot.

It must continuously answer three questions:

| Question | Answered by |
| --- | --- |
| **What am I learning?** | Spaces, Projects, goals, materials, conversations, concepts |
| **How well am I learning it?** | Quizzes, assessments, mistakes, Tutor interactions, mastery estimates |
| **What should I do next?** | Growth analysis, weakness detection, goals, recent activity, recommendations |

The end-to-end learning loop that must work without losing context:

```
Space → Project → Material → Knowledge → Tutor → Grounded Answer + Citation
      → Unsupported-Question Handling → Adaptive Quiz → Assessment → Mastery
      → Growth → Analytics → Recommendation → Continue Learning
```

### Non-negotiable principles

| Principle | Architectural consequence |
| --- | --- |
| **Context First** | Every AI call is scoped to a single `projectId`. No cross-project retrieval, ever. |
| **Evidence Over Guessing** | Retrieval must return enough evidence, or the system says so explicitly. |
| **Persistent but Relevant Context** | A curated `LearningContext` record is stored and selectively retrieved — not full chat history. |
| **Asynchronous by Design** | Document processing, analytics, recommendations, and evaluations run as background jobs. |
| **Observable AI** | Every AI call is persisted with model, feature, latency, tokens, cost, and status. |
| **Safe AI Interaction** | AI reaches application capabilities through validated, permission-aware service functions. |

---

## 3. Technology Stack (with justification)

### 3.1 Summary

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| Backend | Next.js Route Handlers + Server Actions (Node runtime), Zod |
| Database | PostgreSQL 16 + pgvector |
| ORM | Prisma |
| Auth | DB-backed sessions, httpOnly cookies, bcrypt password hashing |
| Document processing | unpdf (text layer) + tesseract.js (OCR fallback) |
| Retrieval | pgvector cosine similarity, project-scoped |
| AI | OpenAI (chat + embeddings) behind a provider abstraction, plus a deterministic mock provider |
| Background jobs | DB-backed queue (`Job` table) + dedicated Node worker, `FOR UPDATE SKIP LOCKED` |
| Storage | Pluggable driver: local filesystem (dev) / S3-compatible (prod) |
| Observability | `AiRequest` + `ActivityEvent` tables, pino structured logs |
| Testing | Vitest (unit/integration), Testing Library (components), Playwright (E2E smoke) |
| Deployment | Docker Compose locally; single Docker host (web + worker) for public URL |

### 3.2 Why these choices

**Next.js 15 full-stack instead of separate frontend/backend.**
The PRD rewards *architecture quality*, not service count. A single Next.js app with a clearly
layered internal structure (`lib/services`, `lib/ai`, `lib/rag`, `lib/jobs`) gives one deploy
target, one type system, shared Zod schemas between client and server, and no duplicated DTOs.
The separation of responsibilities the PRD asks for is enforced by module boundaries, not by
network hops. Route Handlers act as the API/application layer; `lib/services/*` holds business
logic and is the *only* code allowed to touch Prisma.

**PostgreSQL instead of a document store.**
The PRD's data model is fundamentally relational: users → spaces → projects → materials →
chunks/concepts → quizzes → answers → mastery → recommendations → events → AI usage. Referential
integrity and cheap aggregate queries for analytics matter more than schema flexibility. Postgres
also gives us `pgvector`, JSONB for flexible payloads (citations, options, contexts), and window
functions for growth trends — one engine instead of three.

**Prisma as the ORM.**
Type-safe queries that match TypeScript everywhere, declarative migrations, and a single schema
file that doubles as data-model documentation. `pgvector` columns are declared via
`Unsupported("vector(1536)")` and queried with a small number of hand-written `$queryRaw` calls,
which keeps the vector path explicit and reviewable rather than hidden.

**DB-backed job queue instead of Redis + BullMQ.**
Document processing and learning workflows need retries, backoff, job states, and idempotency —
but this is a prototype with modest throughput. A `Job` table using
`SELECT ... FOR UPDATE SKIP LOCKED` provides atomic claiming without adding Redis as a second
stateful dependency, and it means job state is transactionally consistent with the data the job
mutates. The `JobQueue` interface is deliberately narrow (`enqueue`, `claim`, `complete`, `fail`)
so BullMQ can replace the implementation later without touching call sites.

**OpenAI for both generation and embeddings.**
One SDK and one credential covers text generation, JSON-schema structured outputs, and
embeddings — the fastest path to a working, evaluable prototype. It is *not* hard-coded: the
`AIProvider` interface is the seam (see §10), so Anthropic, Gemini, or a local model can be
swapped per-feature via configuration.

**A deterministic mock provider.**
Long-running AI work, tests, and offline development must not depend on a paid API or the
network. `MockAIProvider` produces schema-valid, deterministic output, enabling the full test
suite and CI to run with zero credentials.

### 3.3 Complete tool & framework inventory

**Runtime & language**
- Node.js 22 LTS (min 20)
- TypeScript 5.x (`strict: true`)
- `tsx` — running worker and scripts in TS without a build step

**Frontend**
- `next` 15 (App Router, Route Handlers, Server Actions, Streaming/Suspense)
- `react` 19, `react-dom` 19
- `tailwindcss` v4, `postcss`, `autoprefixer`
- `shadcn/ui` + `@radix-ui/*` primitives — accessible, unstyled-then-styled components
- `lucide-react` — icons
- `recharts` — mastery/growth/analytics charts
- `react-markdown` + `remark-gfm` — rendering Tutor answers
- `@tanstack/react-query` — client-side caching, polling for job/material status
- `sonner` — toasts
- `clsx`, `tailwind-merge`, `class-variance-authority` — class composition

**Backend / validation**
- `zod` — request validation, AI structured-output validation, shared schemas
- `zod-to-json-schema` — deriving JSON Schema for model structured outputs from Zod

**Data**
- `prisma`, `@prisma/client`
- `pg` — raw driver for pgvector queries

**Auth & security**
- `bcryptjs` — password hashing (pure JS, no native build on Windows)
- `jose` — signed session token handling
- Node `crypto` — token generation, hashing idempotency keys, random IDs
- `server-only` — compile-time guard preventing server modules leaking into the client bundle

**Documents**
- `unpdf` — PDF text extraction over `pdfjs-dist`, serverless-friendly
- `pdfjs-dist` — underlying PDF parsing
- `tesseract.js` — OCR fallback for scanned pages
- `file-type` — real content-type sniffing (do not trust client `Content-Type`)
- `sharp` — image normalization before OCR

**AI**
- `openai` — chat completions + embeddings
- `tiktoken` (or `js-tiktoken`) — token accounting for cost/latency analysis

**Jobs & observability**
- Custom `Job` table queue + `scripts/worker.ts`
- `pino` + `pino-pretty` — structured logging

**Testing**
- `vitest` — unit and integration tests
- `@vitest/coverage-v8`
- `@testing-library/react`, `@testing-library/user-event`, `jsdom`
- `playwright` — E2E smoke of the full learning loop
- Test fixtures: seeded fake users/projects/materials; `MockAIProvider` by default

**Dev tooling**
- `eslint` + `eslint-config-next`
- `prettier`
- `dotenv` / Next's built-in env loading
- `docker` + `docker compose` — Postgres (pgvector image)
- `fishery` (optional) — typed test factories

---

## 4. High-Level Design

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js 15 / React 19)             │
│  Home · Space · Project Dashboard · Materials · Tutor · Quiz · Growth ·   │
│  Analytics · Admin                                                        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  fetch / Server Actions (Zod-validated)
┌───────────────────────────────▼──────────────────────────────────────────┐
│                    API / APPLICATION LAYER (Route Handlers)              │
│  authenticate → authorize → validate → dispatch → serialize errors        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────┐
│                          BUSINESS LOGIC (lib/services)                   │
│  ┌───────────┬───────────┬────────────┬───────────┬──────────┬─────────┐ │
│  │ Learning  │   AI      │ Assessment │ Analytics │  Admin   │  Jobs   │ │
│  │ (spaces,  │ (tutor,   │ (quiz,     │ (events,  │ (users,  │ (queue, │ │
│  │ projects, │  prompts, │  grading,  │ trends,   │ AI usage,│ worker, │ │
│  │ materials,│  context) │  mastery,  │ growth)   │ health)  │ retries)│ │
│  │ concepts) │           │  recomms)  │           │          │         │ │
│  └───────────┴───────────┴────────────┴───────────┴──────────┴─────────┘ │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────┐
│                        DATA & KNOWLEDGE LAYER                            │
│  ┌────────────┬───────────────┬──────────────────┬─────────────────────┐ │
│  │ PostgreSQL │ Document      │ Search/Retrieval │ Learning Context    │ │
│  │ (relational│ Storage       │ (pgvector +      │ (goals, strengths,  │ │
│  │  + JSONB)  │ (local / S3)  │  chunk index)    │  weaknesses, prefs) │ │
│  └────────────┴───────────────┴──────────────────┴─────────────────────┘ │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────┐
│                       BACKGROUND PROCESSING (worker)                     │
│  material.process · knowledge.extract · mastery.update · quiz.evaluate ·  │
│  recommend.generate · analytics.rollup · eval.run                        │
│  states · retries · backoff · idempotency · dead-letter                  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────┐
│                    AI / EXTERNAL SERVICES (behind providers)             │
│  AIProvider ── OpenAI │ Mock │ (future: Anthropic, Gemini, Ollama)        │
│  StorageProvider · OcrProvider                                           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────┐
│                             OBSERVABILITY                                │
│  AiRequest (model, feature, latency, tokens, cost, status) ·             │
│  ActivityEvent · Job records · pino logs · AI evaluation runs            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Layer rules (enforced by convention + lint)

1. Route Handlers never call Prisma directly — they call a service.
2. Services never read `request`/`cookies` — they receive a resolved `AuthContext`.
3. Services never call `openai` directly — they call `AIProvider`.
4. Every service function that touches project-scoped data takes an explicit `projectId` and
   verifies ownership before any read or write.
5. AI structured output is always parsed through Zod before persistence.
6. Nothing in `lib/ai`, `lib/rag`, `lib/jobs`, or `lib/db` is importable from a client component.

---

## 5. Repository Structure

```
ai-study-companion/
├── app/
│   ├── page.tsx                       # public landing; redirects signed-in users to /home
│   ├── (auth)/{login,register}/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                 # session guard + header
│   │   ├── home/page.tsx              # Home dashboard
│   │   ├── spaces/[spaceId]/page.tsx
│   │   ├── spaces/[spaceId]/projects/[projectId]/
│   │   │   ├── page.tsx               # Project dashboard
│   │   │   ├── materials/page.tsx
│   │   │   ├── tutor/page.tsx
│   │   │   ├── quiz/page.tsx
│   │   │   ├── quiz/[quizId]/page.tsx
│   │   │   ├── mastery/page.tsx
│   │   │   ├── growth/page.tsx
│   │   │   └── analytics/page.tsx
│   │   └── admin/{page.tsx,users/[userId]/page.tsx,activity/page.tsx,ai/page.tsx}
│   └── api/
│       ├── auth/{register,login,logout}/route.ts
│       ├── spaces/route.ts  spaces/[spaceId]/route.ts
│       ├── projects/route.ts  projects/[projectId]/route.ts
│       ├── materials/route.ts  materials/[materialId]/route.ts
│       ├── tutor/route.ts            # SSE streaming
│       ├── quizzes/route.ts  quizzes/[quizId]/answer/route.ts  quizzes/[quizId]/complete/route.ts
│       ├── recommendations/route.ts
│       ├── analytics/{project,global}/route.ts
│       └── admin/{users,activity,ai,jobs}/route.ts
├── components/
│   ├── ui/                            # shadcn primitives
│   ├── mastery-bar.tsx  citation-card.tsx  material-status.tsx
│   ├── tutor/{chat,message,citation-list}.tsx
│   ├── quiz/{question-card,open-ended,result}.tsx
│   └── charts/{mastery-trend,activity-heatmap,concept-radar}.tsx
├── lib/
│   ├── db.ts                          # Prisma singleton
│   ├── auth/{session,password,guards}.ts
│   ├── services/                      # business logic
│   ├── ai/{provider,openai,mock,features,prompts,schemas,context,telemetry}.ts
│   ├── rag/{chunk,embed,retrieve,cite}.ts
│   ├── documents/{parse,ocr,extract}.ts
│   ├── jobs/{queue,handlers,worker}.ts
│   ├── analytics/{events,growth}.ts
│   ├── storage/{index,local,s3}.ts
│   ├── validation/*.ts                # shared Zod schemas
│   ├── errors.ts  logger.ts  config.ts  rate-limit.ts
├── prisma/{schema.prisma,migrations,seed.ts}
├── scripts/{worker.ts,eval.ts}
├── tests/{unit,integration,e2e}
├── storage/                           # local document storage (gitignored)
├── docker-compose.yml  Dockerfile
├── .env.example
├── README.md  architecture.md
└── docs/{ai-usage.md,development-prompts.md,evaluation.md,limitations.md}
```

---

## 6. Data Model

### 6.1 Entity list

| Entity | Purpose |
| --- | --- |
| `User` | Learner or admin. `role` ∈ {USER, ADMIN}. |
| `Session` | Revocable server session (httpOnly cookie holds the token). |
| `Space` | Broad learning area owned by a user. |
| `Project` | Focused learning journey inside a Space; the isolation boundary. |
| `Material` | Uploaded document + processing state. |
| `Chunk` | Retrievable passage with page reference and embedding. |
| `Concept` | Extracted named concept within a Project, with mastery estimate. |
| `MaterialConcept` | Join: which materials evidence which concepts. |
| `ConceptEvidence` | Append-only mastery evidence (quiz answer, tutor interaction, assessment). |
| `Conversation` | Tutor thread within a Project. |
| `Message` | User/assistant message with citations JSON. |
| `Quiz` | Quiz or assessment session, with mode and status. |
| `QuizQuestion` | Generated question (MCQ or open-ended) with concept + difficulty. |
| `QuizAnswer` | User response, grading result, missing concepts, feedback. |
| `Recommendation` | Suggested next action with reason, priority, and status. |
| `LearningContext` | Persistent learner context: goals, strengths, weaknesses, preferences, repeated mistakes. |
| `ActivityEvent` | Event-driven learning log powering analytics and workflows. |
| `AiRequest` | AI observability record. |
| `Job` | Background job with state, attempts, backoff, idempotency key. |

### 6.2 Relationships

```
User ─1:N─ Space ─1:N─ Project ─1:N─ Material ─1:N─ Chunk
                          │
                          ├─1:N─ Concept ─1:N─ ConceptEvidence
                          │         └─N:M─ Material (MaterialConcept)
                          ├─1:N─ Conversation ─1:N─ Message
                          ├─1:N─ Quiz ─1:N─ QuizQuestion ─1:1─ QuizAnswer
                          ├─1:1─ LearningContext
                          ├─1:N─ Recommendation
                          └─1:N─ ActivityEvent

User ─1:N─ Session
User ─1:N─ AiRequest
User ─1:N─ ActivityEvent
```

**Isolation invariant:** every project-scoped table carries or is reachable from `projectId`.
Chunks duplicate `projectId` (denormalized on purpose) so retrieval can filter by project in a
single indexed query and can never accidentally join across projects.

### 6.3 Key field notes

- `Chunk.embedding` — `Unsupported("vector(1536)")`, accessed only through `lib/rag/retrieve.ts`.
- `Chunk.page` / `ord` — enables citations like *"Machine Learning Notes — Page 14"*.
- `Concept.mastery` — float 0..1, recomputed from `ConceptEvidence`; stored for fast reads.
- `ConceptEvidence` — append-only, so growth analysis is a time series, not a mutable counter.
- `LearningContext` — one row per project, containing curated JSON: goals, strengths, weaknesses,
  preferences, repeated mistakes, and a short "significant tutor context" summary. Never the raw
  transcript.
- `ActivityEvent.type` — enum-like string (`PROJECT_CREATED`, `MATERIAL_UPLOADED`,
  `MATERIAL_READY`, `TUTOR_MESSAGE`, `QUIZ_STARTED`, `QUIZ_COMPLETED`, `ANSWER_GRADED`,
  `MASTERY_UPDATED`, `RECOMMENDATION_CREATED`, `JOB_FAILED`, `UNSUPPORTED_QUESTION`).
- `Job.idempotencyKey` — unique; re-enqueueing the same logical job is a no-op.
- `AiRequest.feature` — `TUTOR`, `QUIZ_GENERATE`, `ANSWER_GRADE`, `CONCEPT_EXTRACT`,
  `EMBED`, `RECOMMEND`, `GROWTH_INSIGHT`.

All tables also carry `createdAt`; mutable ones carry `updatedAt`.

---

## 7. Critical Runtime Flows

### 7.1 Material upload → searchable knowledge

```
Client uploads PDF
  → POST /api/materials (multipart)
  → auth + project ownership check
  → sniff real MIME type, size cap, extension allowlist
  → store file via StorageProvider, create Material(status=QUEUED)
  → enqueue Job(material.process, idempotencyKey=`material:{id}:process`)
  → respond 202 + Material

Worker claims job
  → Material.status = PROCESSING, ActivityEvent(MATERIAL_UPLOADED)
  → extract per-page text (unpdf)
  → if a page has too little text → OCR that page (tesseract.js)
  → normalize + chunk (page-aware, overlapping windows)
  → embed chunks in batches → persist Chunk rows with page + ord
  → AI: extract concepts/relationships → upsert Concept + MaterialConcept
  → rebuild/refresh LearningContext
  → Material.status = READY (+ pageCount), ActivityEvent(MATERIAL_READY),
    Job = COMPLETED
  → on unexpected error: attempts += 1, exponential backoff; at maxAttempts →
    Material.status = FAILED, Job = DEAD, ActivityEvent(JOB_FAILED)
```

The user never waits on this and does not need the browser open.

> **Implementation note (OCR).** The pipeline is implemented and the OCR *policy* works —
> pages with no text layer are detected and selected. The OCR *execution* does not run in
> this environment: PDF.js throws `DataCloneError: Cannot transfer object of unsupported
> type` from its internal message passing when reading embedded images or rasterising a
> page, and `configureUnPDF` offers no way to control transferables. OCR is therefore
> treated as best-effort — a failure is logged and processing continues with the text
> layer. See [`docs/limitations.md`](./docs/limitations.md).

### 7.2 Tutor request (grounded answer with citations)

```
POST /api/tutor  { projectId, conversationId?, message }
  → auth + ownership
  → detect injection patterns in user text; treat all document text as DATA
  → persist user Message
  → retrieve: embed(query) → pgvector top-k WHERE projectId = :projectId
       + fetch Project goal, relevant Concepts, recent assessment summary,
         and LearningContext slice
  → evidence gate: if best similarity < THRESHOLD or no usable chunks →
       return "Insufficient evidence in this Project's materials"
       (no fabricated answer), log ActivityEvent(UNSUPPORTED_QUESTION)
  → build prompt: system rules + evidence blocks (delimited, untrusted) +
       conversation window (last N turns, not full history)
  → stream answer via SSE
  → persist assistant Message with citations JSON [{materialId,title,page,score}]
  → ActivityEvent(TUTOR_MESSAGE)
  → AiRequest row (model, feature, latency, tokens, cost, status)
```

### 7.3 Adaptive quiz loop

```
POST /api/quizzes { projectId, mode, length }
  → read Concept mastery + prior QuizAnswer history + recent activity
  → selection policy: rank concepts by (weakness × importance × recency),
    avoid recently served questions, pick difficulty near the learner's
    current estimate, deliberately revisit repeated mistakes
  → AI generate question(s) constrained to selected concept + retrieved
    evidence; validate with Zod; reject and retry invalid output
  → Quiz(status=IN_PROGRESS, QuizQuestion rows)

Per answer: POST /api/quizzes/:id/answer
  → MCQ: deterministic comparison (no AI call — cost control)
  → Open-ended: AI grading with rubric → {understanding, accuracy, relevance,
    conceptsCovered[], conceptsMissing[], reasoning, feedback}
    → Zod-validated before persistence
  → persist QuizAnswer, ConceptEvidence, recompute Concept.mastery
  → ActivityEvent(ANSWER_GRADED, MASTERY_UPDATED)

On complete: POST /api/quizzes/:id/complete
  → enqueue Job(quiz.evaluate) → weakness detection → growth insight →
    Recommendation rows → ActivityEvent(QUIZ_COMPLETED)
```

Note the deviation from the naive rule the PRD forbids: correctness does **not** simply flip
difficulty easy↔hard. Difficulty is chosen from the mastery estimate plus error history.

### 7.4 Event-driven learning workflow

```
Application Event → enter ActivityEvent log (append-only)
                  → trigger matching workflow (idempotent Job)
                  → update derived state (mastery, LearningContext)
                  → generate insight / recommendation
                  → surface in analytics
```

Events are written in the same transaction as the state change they describe, so analytics can
never drift from the data. Workflows are triggered *after* commit, and re-delivery is safe
because each job carries an idempotency key.

---

## 8. Security & Data Isolation

| Concern | Design |
| --- | --- |
| Authentication | bcrypt password hashing; server-side session rows; httpOnly + SameSite=Lax + Secure (prod) cookies; constant-time compares |
| Authorization | `requireUser()` and `requireProjectAccess(userId, projectId)` guards on every project-scoped route; admin routes require `role = ADMIN` |
| Data isolation | Every project query filters by `projectId` *and* verifies ownership; chunks carry `projectId`; retrieval is project-scoped by construction. Cross-project leakage is covered by a dedicated test. |
| Input validation | Zod on every request body, query param, and AI structured output |
| File handling | Real MIME sniffing (`file-type`), size cap, extension allowlist, randomized stored filenames, no execution of stored content, path traversal prevention |
| Prompt injection | Document and user text is untrusted **data**: wrapped in explicit delimiters, never concatenated into the instruction region; system prompt states that materials are reference material and cannot issue instructions; injection signals are detected and logged |
| AI ↔ app boundary | AI can only act through named, validated service functions registered as tools; each validates arguments and re-checks authorization; AI never gets DB, filesystem, or network access |
| State-changing AI output | Never persisted raw — parsed and validated against a Zod schema first |
| Rate limiting | Per-user token bucket on AI and upload endpoints |
| Secrets | `.env` only, never committed; `.env.example` documents the shape |

---

## 9. Background Processing Design

**Job lifecycle**

```
PENDING → RUNNING → COMPLETED
                 ↘ FAILED → (backoff, retry) → PENDING
                          ↘ DEAD (maxAttempts exhausted)
```

**Mechanics**

- Claim atomically: `UPDATE "Job" SET status='RUNNING', lockedAt=now(), attempts=attempts+1
  WHERE id = (SELECT id FROM "Job" WHERE status IN ('PENDING','FAILED') AND runAt <= now()
  ORDER BY runAt FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
- Safe for multiple concurrent worker processes.
- **Retries:** exponential backoff with jitter (`delay = base * 2^attempts`), bounded by
  `maxAttempts` (default 3).
- **Idempotency:** unique `idempotencyKey`; handlers are written to be re-runnable (upsert
  instead of insert, replace-in-place chunk sets).
- **Stale lock recovery:** a job `RUNNING` beyond a timeout is reclaimed, so a crashed worker
  cannot strand work.
- **Dead letter:** exhausted jobs are retained with `lastError` and surfaced in the Admin
  dashboard's Background Processing view.
- **Observability:** attempts, last error, timing, and payload are visible per job.

**Handler registry**

| Job | Trigger | Effect |
| --- | --- | --- |
| `material.process` | upload | parse, OCR, chunk, embed, extract concepts, set `Material.status` |
| `knowledge.extract` | post-process | concepts + relationships + `MaterialConcept` links |
| `quiz.evaluate` | quiz complete | mastery recompute, weakness detection, insight |
| `mastery.update` | answers graded | recompute mastery from evidence, refresh `LearningContext` |
| `recommend.generate` | quiz/assessment/weakness | produce `Recommendation` rows |
| `context.refresh` | significant activity | rebuild curated `LearningContext` slice |
| `eval.run` | manual/scheduled | execute AI evaluation suites, store results |

---

## 10. AI Engineering Layer

### 10.1 Provider abstraction

```ts
interface AIProvider {
  generateText(req: TextRequest): Promise<TextResult>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<T>;   // Zod-validated
  embed(req: EmbedRequest): Promise<number[][]>;
  streamText?(req: TextRequest): AsyncIterable<TextChunk>;        // optional capability
}
```

Implementations: `OpenAIProvider`, `MockProvider` (deterministic, schema-valid), and room for
Anthropic/Gemini/Ollama. Selected via `AI_PROVIDER` env var. Feature-level overrides allow, for
example, a cheap model for concept extraction and a stronger one for the Tutor.

Two constraints discovered during implementation:

- **Structured-output schemas must not contain value-changing transforms** (`.trim()`,
  `.toLowerCase()`). Strict structured outputs derive a JSON Schema from the Zod schema, and a
  transform cannot be represented there — the provider rejects the entire request. Normalise the
  validated result in the feature instead. A unit test asserts this for every registered schema.
- **The mock provider validates its own output** against the caller's schema and refuses to invent
  a shape for an unregistered schema name. A mock that returned arbitrary objects would let a
  feature pass its tests and then fail the first time a real model was wired in.

Streaming calls record telemetry in a `finally`, so a row exists even when the consumer disconnects
mid-stream; the latency then reflects the true stream duration and the token count is partial.

### 10.2 Feature modules

- `tutorAnswer` — grounded answer with citations and the evidence gate
- `generateQuizQuestions` — evidence-constrained, concept-targeted
- `gradeOpenEndedAnswer` — rubric-based structured grading with feedback
- `extractConcepts` — concept/relationship extraction from processed text
- `summarizeForContext` — compress a thread into LearningContext-worthy notes rather than storing raw history
- `generateRecommendations` — insight → next-best action
- `growthInsight` — natural-language explanation of mastery trends

### 10.3 Context composition

Every AI call composes context from four *selective* sources:

```
Current request
  + Project identity (name, description, goal)
  + Retrieved evidence (project-scoped chunks, top-k, scored)
  + Learning context slice (relevant strengths/weaknesses/goals/prefs)
  + Conversation window (last N turns + rolling summary)
  = composed prompt
```

Full conversation history is never sent; older turns are summarized into `LearningContext`.

### 10.4 Observability

Every AI call writes an `AiRequest` row: `feature`, `provider`, `model`, `promptTokens`,
`completionTokens`, `latencyMs`, `costUsd` (from a model price table), `status`, `error`,
`projectId`, `userId`, plus a hash of the prompt template version. This is what makes the PRD's
investigation questions answerable:

| Question | Answered by |
| --- | --- |
| Why was a response slow? | `latencyMs` by feature/model + retrieval timing |
| Which model was used? | `model` per AiRequest |
| Why did retrieval return poor context? | stored retrieval scores + chunk/page refs |
| Which workflow failed? | `status='FAILED'` joined to `Job.lastError` |
| How much did a request cost? | `costUsd` aggregated per project/user/feature |

### 10.5 Evaluation

Suites in `scripts/eval.ts` with curated cases and stored results:

| Suite | Checks |
| --- | --- |
| Tutor | accuracy, groundedness, citation correctness, refusal on unsupported questions |
| Retrieval | relevance of returned chunks, source quality, isolation (no cross-project hits) |
| Assessment | question quality, grading agreement with rubric, structured-output validity, adaptivity |
| Recommendations | relevance, actionability, alignment with learner state |

Methods: curated fixtures, rule-based assertions, model-based grading against a rubric, and
optional human review. Baseline results are committed so prompt/model/retrieval changes can be
diffed — the mechanism that detects regressions.

---

## 11. API Surface

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/logout` | session lifecycle |
| `GET/POST /api/spaces`, `GET/PATCH/DELETE /api/spaces/:id` | Space CRUD |
| `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id` | Project CRUD + dashboard summary |
| `POST /api/materials`, `GET /api/materials/:id` | upload (202) + status polling |
| `POST /api/tutor` | SSE streaming grounded answer |
| `GET /api/conversations/:projectId` | conversation history |
| `POST /api/quizzes` | start adaptive quiz |
| `POST /api/quizzes/:id/answer` | submit + grade an answer |
| `POST /api/quizzes/:id/complete` | finalize → enqueue evaluation |
| `GET /api/recommendations?projectId=` | current recommendations |
| `GET /api/analytics/project/:projectId`, `/global` | analytics |
| `GET /api/admin/{users,activity,ai,jobs,health}` | admin views |

Conventions: `{ data }` on success, `{ error: { code, message, details? } }` on failure, proper
status codes, `401` unauthenticated, `403` unauthorized, `404` not-found-or-not-yours
(deliberately indistinguishable to avoid probing).

---

## 12. Frontend Experience

- **Home** — Continue Learning, recent projects, overall progress, areas needing attention,
  recommended next action.
- **Space** — projects, activity, progress, attention areas.
- **Project dashboard** — learning state, key concepts, recent activity, performance, latest
  activity, recommended next step, and navigation into Materials → Tutor → Quiz → Growth →
  Analytics.
- **Materials** — upload with live status (queued/processing/ready/failed + retry).
- **Tutor** — streaming chat, inline citations that link back to the source page, explicit
  insufficient-evidence state.
- **Quiz** — MCQ and open-ended questions, per-answer feedback naming what was understood and
  what is missing (not just a score), adaptive progression.
- **Mastery / Growth** — concept bars, trend lines, improving/stable/needs-attention groupings.
- **Analytics** — activity, assessment performance, mastery, concept trends, AI activity.
- **Admin** — users, spaces, projects, activity (filterable by user/space/project/type/time),
  learning analytics, AI usage, AI evaluation, background processing, system health, per-user
  learning journey inspection.

Accessibility and responsiveness are baseline: keyboard navigation, labelled controls,
sufficient contrast, loading/empty/error states everywhere.

---

## 13. Testing Strategy

| Layer | Coverage |
| --- | --- |
| Unit | mastery computation, adaptive selection policy, chunking, cost calculation, citation formatting, prompt-injection detection |
| Integration | auth, authorization, **project isolation**, validation, material pipeline with `MockProvider`, job retries/failure/idempotency, grading persistence |
| AI behavior | grounded answer, unsupported-question refusal, structured-output validity, evaluation suites |
| E2E (Playwright) | register → create space → create project → upload → ask Tutor → take quiz → see mastery/growth → recommendation → admin view |

Run with `MockAIProvider` by default so CI needs no API key; a separate opt-in suite hits the real
provider for grounding checks.

---

## 14. Configuration & Deployment

**Environment variables** (`.env.example`):

```
DATABASE_URL=postgresql://...
AI_PROVIDER=openai|mock
OPENAI_API_KEY=
AI_MODEL_TUTOR=  AI_MODEL_QUIZ=  AI_MODEL_EXTRACT=  AI_EMBED_MODEL=
RETRIEVAL_TOP_K=6  RETRIEVAL_MIN_SCORE=0.35
AUTH_SECRET=
STORAGE_DRIVER=local|s3
S3_BUCKET= S3_REGION= S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY=
MAX_UPLOAD_MB=25
JOB_MAX_ATTEMPTS=3  JOB_POLL_MS=2000
LOG_LEVEL=info
```

**Local**: `docker compose up -d db` → `npm run db:migrate` → `npm run db:seed` →
`npm run dev` (web) + `npm run worker` (jobs).

**Public**: web on Vercel (or the same Docker host), managed Postgres with pgvector (Neon /
Supabase / RDS), worker as a long-running process on Railway / Fly / Render (required because
jobs must not be tied to a request lifecycle), documents on S3-compatible storage.

Secrets stay in the platform's environment configuration — never in the repository.

---

## 15. Phased Build Plan

Ordered so that something coherent is always runnable. No phase depends on unfinished work.

**Phase 1 — Foundation**
Scaffold Next.js + TS + Tailwind; Docker Compose Postgres/pgvector; Prisma schema + first
migration; config module; Prisma singleton; error and logging helpers; `.env.example`.
*Done when:* `npm run dev` boots and migrations apply cleanly.

**Phase 2 — Identity & Isolation**
Password hashing, session table, login/register/logout, `requireUser`,
`requireProjectAccess`, route guards, seed script.
*Done when:* two users cannot see each other's data, proven by test.

**Phase 3 — Spaces & Projects**
CRUD + dashboards, project dashboard summary aggregation, activity event writes.
*Done when:* a user can create a Space, create a Project with a goal, and see both dashboards.

**Phase 4 — AI Layer**
`AIProvider` interface, OpenAI + mock implementations, Zod schemas, feature modules, context
composer, `AiRequest` telemetry, prompt-injection guards.
*Done when:* mock and real providers both return schema-valid output and every call is logged.

**Phase 5 — Materials & Jobs**
Upload endpoint, storage provider, PDF parse + OCR fallback, chunking, embedding, concept
extraction, `Job` table + queue + worker + retries + idempotency, Materials UI with status.
*Done when:* uploading a PDF reaches `READY` asynchronously and a forced failure retries then
dead-letters visibly.

**Phase 6 — Tutor**
pgvector retrieval scoped by project, evidence gate, streaming SSE answer, citations,
conversation persistence, insufficient-evidence state.
*Done when:* answers cite real pages and out-of-scope questions are explicitly refused.

**Phase 7 — Assessment**
Adaptive selection policy, MCQ + open-ended generation, deterministic MCQ grading, AI rubric
grading with feedback, mastery updates from evidence.
*Done when:* quiz difficulty responds to mastery, and open-ended answers get explanatory feedback.

**Phase 8 — Mastery, Growth, Recommendations, Context**
Mastery recomputation, evidence time series, growth classification
(improving/stable/needs attention), recommendation generation, curated `LearningContext`.
*Done when:* the Project dashboard states a defensible next action.

**Phase 9 — Analytics & Admin**
Project + global analytics, activity feeds with filters, AI usage and evaluation views, background
processing and system health views, per-user journey inspection.
*Done when:* an admin can trace one user from activity → assessment → mastery → AI usage.

**Phase 10 — Hardening, Docs, Deploy**
Rate limiting, timeouts, retry/fallback polish, accessibility and empty/error states, README,
architecture, AI usage, development prompts, evaluation approach, limitations; tests green;
deploy to a public URL with a working worker.
*Done when:* the full learning loop is demonstrable end-to-end on the public URL.

---

## 16. Deliberate Simplifications & Upgrade Path

| Simplification | Why | Upgrade |
| --- | --- | --- |
| DB-backed queue, no Redis | Avoids a second stateful dependency; job state stays transactionally consistent with the data it mutates | Swap in BullMQ behind the same `JobQueue` interface |
| Single pgvector index, no hybrid search | Time-boxed; dense retrieval is sufficient at prototype scale | Add Postgres full-text + reciprocal rank fusion |
| No cross-encoder reranking | Extra latency and cost for marginal prototype gain | Add a reranking stage after top-k |
| Concept graph is shallow (concepts + material links) | Full knowledge-graph extraction is costly and noisy | Add typed relationships and prerequisite inference |
| OCR only on low-text pages | Full-document OCR is slow | Page-level OCR confidence and image/figure understanding |
| Session auth, no OAuth/SSO | Out of prototype scope | OAuth providers, email verification, password reset |
| Cost table is static | Prices change rarely | Fetch from config or provider metadata |
| No multi-tenant org model | PRD is user-centric | Add Organisation → Space hierarchy |

**Planned future work:** streaming everywhere, spaced repetition, flashcards, concept maps,
voice learning, notifications, collaboration, richer AI tracing, provider fallback and
cost-aware routing.

---

## 17. Definition of Done

- A user completes the whole learning loop without losing context: Space → Project → Material →
  Knowledge → Grounded Answer + Citation → Unsupported-Question Handling → Adaptive Quiz →
  Assessment → Mastery → Growth → Analytics → Recommendation.
- An admin can inspect users, projects, activity, analytics, AI usage, AI evaluation, and
  background processing health.
- Project data isolation is enforced and tested.
- AI is abstracted, observable, cost-tracked, and evaluated with a baseline to diff against.
- Background processing survives failure with retries, idempotency, and visible dead letters.
- Tests, README, architecture, AI-usage, development-prompt, evaluation, and limitations docs
  exist; the app is deployed to a public URL with secrets kept out of the repository.
