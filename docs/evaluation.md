# Evaluation

How the quality of the AI features is measured, what each check actually asserts, and — more
usefully — how the checks are allowed to fail.

```bash
npm run eval
```

---

## Approach

§10.5 asks for suites in `scripts/eval.ts` with curated cases, rule-based assertions, and
model-based grading. That is what exists, with one addition the specification does not mention and
that running it made necessary: the two kinds of check are **not** given the same authority.

The runner:

1. provisions a **fixed fixture project** (`eval-fixture@example.com`) — the same document, the same
   concepts, and a deliberate learner profile (strong on one concept, failing another), so a change
   in the numbers is a change in the system rather than in the data;
2. enqueues one `EVAL_RUN` job and drains it, so the suites run through the same job spine as
   production work;
3. prints a per-check report and **exits non-zero if any assertion fails**;
4. stores the report as the job's `result`, which is what `/admin/ai` displays.

## The four suites

| Suite | Checks |
| --- | --- |
| **Tutor** | a grounded answer cites this project's own material · an unsupported question is refused with no answer streamed · *metric*: the answer is grounded in the retrieved evidence |
| **Retrieval** | the query's own passage ranks first · every hit belongs to this project · every retrieved chunk's denormalised `projectId` agrees with the project queried |
| **Assessment** | a quiz is generated with questions · a multiple-choice answer key is one of its options · question difficulty equals the value the mastery estimate implies |
| **Recommendations** | at least one is produced · every one states the reason that prompted it · priorities are within range · *metric*: the top one is actionable rather than generic |

The retrieval suite is the isolation test written as an evaluation: retrieval scopes on
`Chunk.projectId`, which is *denormalised*, so if that column ever drifted from its material's
project, retrieval would leak across projects. The check reads the stored chunks back and compares.

---

## Assertions and metrics

**Assertions** are pass/fail requirements. They decide whether the run passed.

**Metrics** are model-graded scores. They are recorded with their evidence, flagged when below their
floor, and shown in `/admin/ai` — but they **cannot fail the run on their own.**

That is not a convenience, it is a measurement. The recommendation actionability criterion, unchanged
and on an unchanged system, scored:

| Run | Score | Verdict |
| --- | --- | --- |
| 1 | 0.30 | below floor |
| 2 | 1.00 | pass |
| 3 | 0.85 | pass |
| 4 | 0.40 | below floor |

A model grading a model is a noisy instrument. Gating on it would make `npm run eval` fail at random
and teach everyone to ignore it — which is worse than having no harness at all. §10.5's own answer is
*"baseline results are committed so prompt/model/retrieval changes can be diffed"*: a metric is
something to **compare over time**, and that diffing is deliberately not built yet (see
[`limitations.md`](./limitations.md)).

A run therefore ends like this:

```
PASSED: 11 assertion(s) passed, 0 failed · 2 metric(s) recorded, 1 below floor
```

Read it as: *nothing is broken, and one quality number is low enough to look at.*

---

## A criterion that was corrected

The Tutor groundedness metric originally asked whether **every factual claim** in the answer was
supported by the reference material. It scored **0.40** on an answer that correctly cited
*"Evaluation fixture.pdf – page 1"* and then explained what it had read.

Two things were wrong, and only one of them was the criterion:

1. **The reference was too narrow.** The check fed the grader a single passage, while the answer
   legitimately drew on the three passages the Tutor had retrieved. Fixed: the reference is the
   evidence the Tutor actually had.
2. **The criterion did not match the contract.** §7.2 requires answers grounded in the project's
   evidence with citations, and a refusal when the evidence does not support one. It never promised
   that every sentence would be a quotation — and a tutor that only parrots sentences is useless.
   The criterion now detects **invention**, not exposition.

That is written down here rather than quietly changed, because "the check was wrong" and "the system
was wrong" look identical if nobody says which.

---

## What a result means, and what it does not

**It does mean:** the retrieval path returns this project's own chunks and nothing else; the Tutor
cites real pages and refuses what it cannot support; generated questions carry a usable answer key at
the difficulty the mastery estimate implied; recommendations cite the observation that prompted them.

**It does not mean:** that answers are *good*, that questions are *well written*, or that a learner
would be satisfied. Those are judgements a rubric score gestures at, and the metrics are recorded
rather than trusted.

Nor does it mean a regression will be caught. A metric that quietly drops from 0.9 to 0.6 appears in
the report as a lower number, which someone has to read. Baseline diffing is the fix and is not built.

---

## Known gaps

- **No committed baseline.** The single biggest gap, called out by §10.5 itself. Without one, only
  the current run's numbers exist; there is nothing to diff against.
- **No human review.** The specification lists it as optional; nothing implements it.
- **The fixture is one document.** Three pages about gradient descent. It exercises the plumbing on
  a narrow slice of subject matter, and says nothing about how the system behaves on a 200-page
  textbook or a table-heavy report.
- **Cost is not asserted.** No check would notice if a change tripled the model spend; `AiRequest`
  records `costUsd`, but for the current model that column is `0`.
