import { z } from "zod";

/**
 * Structured-output schemas.
 *
 * Every value the model returns that will be persisted or used to change
 * application state is declared here and validated before use. A model that returns
 * plausible-looking but malformed data is a failure, not a partial success.
 *
 * IMPORTANT: no value-changing transforms (`.trim()`, `.toLowerCase()`) in these
 * schemas. Provider-side strict structured outputs derive a JSON Schema from the Zod
 * schema, and transforms cannot be represented there — including one makes the
 * provider reject the request outright. Normalise the validated result afterwards
 * instead.
 */

export const extractedConceptSchema = z.object({
  name: z.string().min(1, "Concept name is required.").max(120, "Concept name is too long."),
  description: z
    .string()
    .max(400, "Concept description is too long.")
    .describe("One or two sentences explaining the concept in the context of this material."),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe("How central this concept is to the material, from 0 (peripheral) to 1 (core)."),
  relatedConcepts: z
    .array(z.string().min(1).max(120))
    .max(6)
    .describe("Names of other concepts in this extraction that this one depends on or relates to."),
});

export const conceptExtractionSchema = z.object({
  concepts: z
    .array(extractedConceptSchema)
    .max(25)
    .describe("The concepts a learner should take away from this material."),
});

export type ExtractedConcept = z.infer<typeof extractedConceptSchema>;
export type ConceptExtraction = z.infer<typeof conceptExtractionSchema>;

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export const quizOptionSchema = z.object({
  id: z
    .string()
    .min(1, "Option id is required.")
    .max(8, "Option id is too long.")
    .describe('Short stable identifier for the option, such as "a", "b", "c", "d".'),
  text: z.string().min(1, "Option text is required.").max(400, "Option text is too long."),
});

/**
 * One generated question.
 *
 * `options` / `correctAnswer` are null for open-ended questions rather than sentinel
 * empty values, so "no answer key" is expressed by the type instead of by convention.
 */
export const generatedQuestionSchema = z.object({
  prompt: z
    .string()
    .min(1, "Question prompt is required.")
    .max(1000, "Question prompt is too long.")
    .describe("The question exactly as it should be shown to the learner."),
  options: z
    .array(quizOptionSchema)
    .max(6)
    .nullable()
    .describe(
      "Exactly four plausible options for a multiple-choice question — one correct and three that are clearly wrong but tempting. Null for an open-ended question.",
    ),
  correctAnswer: z
    .string()
    .max(8)
    .nullable()
    .describe(
      "The id of the correct option for a multiple-choice question. Null for an open-ended question.",
    ),
  explanation: z
    .string()
    .max(600)
    .nullable()
    .describe(
      "Why the correct answer is correct. Null for an open-ended question.",
    ),
});

/** Rubric grading for an open-ended answer. */
export const openEndedGradeSchema = z.object({
  understanding: z
    .number()
    .min(0)
    .max(1)
    .describe("How well the learner grasped the underlying idea, from 0 to 1."),
  accuracy: z
    .number()
    .min(0)
    .max(1)
    .describe("How factually correct the answer is, from 0 to 1."),
  relevance: z
    .number()
    .min(0)
    .max(1)
    .describe("How directly the answer addresses the question asked, from 0 to 1."),
  conceptsCovered: z
    .array(z.string().min(1).max(120))
    .max(8)
    .describe("Names of the concepts the answer demonstrates understanding of."),
  conceptsMissing: z
    .array(z.string().min(1).max(120))
    .max(8)
    .describe("Names of the concepts a complete answer would have included but this one did not."),
  reasoning: z
    .string()
    .min(1)
    .describe(
      "Why this grade was given, justified against the reference material. For audit, not shown to the learner.",
    ),
  feedback: z
    .string()
    .min(1)
    .describe(
      "Learner-facing explanation that names what they got right and precisely what is missing or wrong. Never only a score or a restatement of the answer. Two or three sentences.",
    ),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type OpenEndedGrade = z.infer<typeof openEndedGradeSchema>;

// ---------------------------------------------------------------------------
// Growth, recommendations, curated context
// ---------------------------------------------------------------------------

/**
 * Length policy for these schemas.
 *
 * Strict structured outputs are enforced *server-side*, so a `maxLength` the model
 * overshoots is a hard 400, not a warning — a summary that ran to 732 characters against
 * a 600 cap failed the whole call in testing. Generated **prose** therefore carries no
 * hard cap; length is requested in the description and enforced by truncation where the
 * value is persisted. Caps remain only where a value is structural and truncating it
 * would corrupt the artefact (a question's `prompt`).
 */

export const recommendationSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      'Short, imperative action, such as "Review gradient descent". Aim for under 80 characters.',
    ),
  body: z
    .string()
    .min(1)
    .describe("What to do and how it will help, addressed to the learner. One or two sentences."),
  reason: z
    .string()
    .min(1)
    .describe(
      "The specific evidence in the learner's data that prompted this — name the concept and the observation, not a generality. One sentence.",
    ),
  priority: z
    .number()
    .min(0)
    .max(1)
    .describe("0 means worth doing eventually; 1 means this is the next thing to do."),
  conceptName: z
    .string()
    .max(120)
    .nullable()
    .describe(
      "The project concept this concerns, copied exactly from the list provided. Null when it concerns the project as a whole.",
    ),
});

export const recommendationsSchema = z.object({
  recommendations: z
    .array(recommendationSchema)
    .min(1)
    .max(5)
    .describe("Between one and five actions, most important first."),
});

/**
 * Notes for a future tutor.
 *
 * Deliberately a single short string rather than a transcript: §6.3 requires that
 * `LearningContext` never stores raw conversation, and a compressed summary is what a
 * later prompt can actually afford to include.
 */
export const contextSummarySchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "Short factual notes for a future tutor: what this learner has covered, where they struggled, and how they prefer to be taught. Not a transcript and not a list of quotes. Aim for under 500 characters.",
    ),
});

export type RecommendationSuggestion = z.infer<typeof recommendationSchema>;
export type Recommendations = z.infer<typeof recommendationsSchema>;
export type ContextSummary = z.infer<typeof contextSummarySchema>;

/**
 * Model-based grading for the evaluation harness (§10.5).
 *
 * Rule-based assertions cover what can be checked mechanically; this covers the rest —
 * whether an answer is actually grounded in the material, whether a recommendation is
 * genuinely actionable. A rubric, so a low score can be explained rather than asserted.
 */
export const evalGradeSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("How fully the artefact satisfies the stated criterion, from 0 to 1."),
  verdict: z.string().min(1).describe("One short sentence stating the judgement."),
  notes: z
    .string()
    .min(1)
    .describe(
      "What specifically supports or undermines the judgement, referring to the artefact. Two or three sentences.",
    ),
});

export type EvalGrade = z.infer<typeof evalGradeSchema>;

/** Registry keys used to pick a mock response and to name the provider-side schema. */
export const SCHEMA_NAMES = {
  conceptExtraction: "ConceptExtraction",
  quizQuestion: "QuizQuestion",
  openEndedGrade: "OpenEndedGrade",
  recommendations: "Recommendations",
  contextSummary: "ContextSummary",
  evalGrade: "EvalGrade",
} as const;

export type SchemaName = (typeof SCHEMA_NAMES)[keyof typeof SCHEMA_NAMES];
