# AI usage

Two different questions, deliberately kept apart: **which AI wrote this software**, and **which
AI the software runs on**. Conflating them is how a project ends up unable to say what it actually
spends or why a response was slow.

---

## 1. AI used to build the product

The product was developed with an AI coding agent driving the implementation, under
human direction. That agent:

- read the specification in [`architecture.md`](../architecture.md) and worked through it phase by
  phase, in the order §15 lays out;
- wrote the application, the tests, and the documentation;
- ran the test suite, the production build, and the acceptance harnesses after each phase.

**Models during development.** The agent's own model is a hosted frontier model. Nothing about it
is part of the shipped system — it does not appear in the repository, in configuration, or at
runtime, and no credential for it exists in this codebase.

**What that means for review.** Commits are the record. Every phase's plan was written before its
code, and a regression seen later can be traced to the change that caused it.

---

## 2. AI used by the product

### Generation and embeddings are separate providers

No single provider does both jobs, so they are configured independently:

| Role | Setting | Options | Currently |
| --- | --- | --- | --- |
| Generation | `AI_PROVIDER` | `mock`, `openai`, `groq` | `groq` |
| Embeddings | `AI_EMBED_PROVIDER` | `mock`, `openai`, `local` | `local` |

- **Groq** is served by the same OpenAI-compatible provider as OpenAI — it speaks the same wire
  protocol — with a different key and base URL. It serves chat, streaming, and strict structured
  output, but it has **no embeddings endpoint** (`POST /embeddings` returns 404).
- **Local embeddings** therefore do the retrieval half: a small sentence-transformer
  (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) runs in-process through ONNX Runtime. No key, no
  per-query cost, no network after the model is downloaded once.
- **`mock`** exists for tests, CI and offline work. Its embeddings are deterministic but **not
  semantic**, so retrieval matches nothing and the Tutor refuses every question. It is not a
  demonstration mode.

### Per-feature model routing

One `AI_MODEL_*` variable per feature, so a cheaper model can serve the high-volume work:

| Feature | Variable | Default |
| --- | --- | --- |
| `TUTOR` | `AI_MODEL_TUTOR` | `openai/gpt-oss-120b` |
| `QUIZ_GENERATE` | `AI_MODEL_QUIZ` | `openai/gpt-oss-120b` |
| `ANSWER_GRADE` | `AI_MODEL_GRADE` | `openai/gpt-oss-120b` |
| `CONCEPT_EXTRACT` | `AI_MODEL_EXTRACT` | `openai/gpt-oss-120b` |
| `RECOMMEND`, `GROWTH_INSIGHT` | `AI_MODEL_RECOMMEND` | `openai/gpt-oss-120b` |
| `EVAL` | `AI_MODEL_GRADE` | `openai/gpt-oss-120b` |
| `EMBED` | `AI_EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` |

Routing is configuration, not code: `modelForFeature()` in `lib/ai/index.ts` is the only place that
decides, and it is exhaustive over the `AiFeature` enum — adding a feature without deciding its
model is a compile error.

### Where AI is actually called

Nothing in the application talks to a model directly. Everything goes through
`lib/ai/index.ts`, and every call is one of these:

| Path | Feature | Cost shape |
| --- | --- | --- |
| Tutor answer | `TUTOR` | Streamed; the most expensive call in the system |
| Question generation | `QUIZ_GENERATE` | One call per question |
| Open-ended grading | `ANSWER_GRADE` | One call per written answer |
| MCQ grading | — | **None** — string comparison |
| Concept extraction | `CONCEPT_EXTRACT` | One call per processed document |
| Recommendations | `RECOMMEND` | One call per quiz completion |
| Context summary | `GROWTH_INSIGHT` | One call per rebuild, only when a conversation exists |
| Query embedding | `EMBED` | Local; free |
| Evaluation grading | `EVAL` | Only when `npm run eval` is run |

### Observability

Every call writes one `AiRequest` row — **including failures**, which are as informative as slow
successes. `lib/ai/telemetry.ts` owns the write; features do not think about it.

| Column | Answers |
| --- | --- |
| `feature`, `model`, `provider` | which model ran, and for what |
| `promptTokens`, `completionTokens` | how much it cost in tokens |
| `latencyMs` | why a response was slow |
| `costUsd` | what it cost (see the caveat below) |
| `status`, `error` | which workflow failed, and why |
| `promptVersion` | which prompt template produced this — so output quality can be correlated with a template change |

Two surfaces read it: the project's own analytics page, and `/admin/ai`.

**Cost is currently understated.** `openai/gpt-oss-120b` has no entry in `lib/ai/pricing.ts`, so
Groq calls record `0`. Token counts and latencies are real; the cost column is not yet. That is
recorded in [`limitations.md`](./limitations.md) rather than papered over.

### Guardrails that apply to every call

- **Structured output is re-validated locally.** Provider-side schema enforcement is a request, not
  a guarantee: every structured response is parsed through its Zod schema before it can reach the
  database, and a failure raises `AiInvalidOutputError` rather than being partially repaired.
- **Generated prose carries no hard length cap.** Strict structured outputs are enforced
  server-side, so a `maxLength` the model overshoots is rejected outright — a 732-character summary
  against a 600-character cap failed a whole call during acceptance testing. Length is requested in
  the prompt and enforced by truncation where the value is stored.
- **Materials and messages are data, never instructions.** Document text, learner answers and
  conversation turns are fenced in labelled `<untrusted_document>` blocks that cannot be closed from
  inside. Apparent injection attempts are logged as signals, not blocked — a filter would also
  reject legitimate material *about* prompt injection.
