import { AiFeature } from "@prisma/client";
import { aiGenerateStructured } from "@/lib/ai";
import {
  PROMPT_VERSIONS,
  UNTRUSTED_CONTENT_RULES,
  composePrompt,
  detectInjectionSignals,
  untrustedBlock,
} from "@/lib/ai/prompts";
import {
  SCHEMA_NAMES,
  generatedQuestionSchema,
  type GeneratedQuestion,
} from "@/lib/ai/schemas";
import { AiInvalidOutputError } from "@/lib/errors";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import { logger } from "@/lib/logger";

/**
 * Question generation for the adaptive quiz.
 *
 * One question per call, rather than a whole quiz per call. The selection policy has
 * already decided the concept, the type, and the difficulty, so a single tightly-scoped
 * prompt produces better questions than asking for a mixed set — and validation stays
 * trivial, because a failure is about one question instead of a whole batch.
 *
 * Generation is evidence-constrained: the material is fenced as untrusted data, and the
 * prompt requires the question to be answerable from it alone.
 */

export type QuestionType = "MULTIPLE_CHOICE" | "OPEN_ENDED";

export type GenerateQuestionInput = {
  project: { name: string; description: string; goal: string };
  concept: { name: string; description: string | null; mastery: number };
  type: QuestionType;
  difficulty: number;
  evidence: RetrievedChunk[];
};

/** Keeps a single generation prompt within a sane budget. */
const MAX_EVIDENCE_CHARACTERS = 12_000;

/** One retry: enough to recover from a malformed answer without an unbounded loop. */
const MAX_ATTEMPTS = 2;

function trimEvidence(evidence: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let used = 0;

  for (const chunk of evidence) {
    if (used + chunk.content.length > MAX_EVIDENCE_CHARACTERS) continue;
    kept.push(chunk);
    used += chunk.content.length;
  }

  return kept;
}

export function composeQuestionPrompt(input: GenerateQuestionInput): {
  system: string;
  prompt: string;
} {
  const evidence = trimEvidence(input.evidence);
  const isMultipleChoice = input.type === "MULTIPLE_CHOICE";

  const system = composePrompt([
    `You write assessment questions for the learning project "${input.project.name}".`,
    "Every question must be answerable from the reference material provided, and from nothing else.",
    isMultipleChoice
      ? "Produce a multiple-choice question with exactly four options whose ids are \"a\", \"b\", \"c\" and \"d\". Exactly one option is correct; the other three must be plausible to someone who has not understood the material, but unambiguously wrong to someone who has."
      : "Produce an open-ended question that requires the learner to explain something in their own words, so their reasoning can be assessed. There is no answer key.",
    "Difficulty 0 means straightforward recall; difficulty 1 means transfer, edge cases, or distinguishing similar ideas. Match the requested difficulty.",
    isMultipleChoice
      ? "The explanation must say why the correct option is correct."
      : "There is no explanation for an open-ended question; set it to null.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const prompt = composePrompt([
    "Project context:",
    `Name: ${input.project.name}`,
    `Description: ${input.project.description}`,
    `Learning goal: ${input.project.goal}`,
    `Concept: ${input.concept.name}`,
    input.concept.description ? `Concept description: ${input.concept.description}` : undefined,
    `Question type: ${input.type}`,
    `Difficulty: ${input.difficulty.toFixed(2)}`,
    `Learner's current mastery of this concept: ${Math.round(input.concept.mastery * 100)}%`,
    "Reference material:",
    ...evidence.map((chunk) =>
      untrustedBlock(`${chunk.title} - page ${chunk.page ?? "unknown"}`, chunk.content),
    ),
    isMultipleChoice
      ? "Write one multiple-choice question about the concept above, answerable from the reference material."
      : "Write one open-ended question about the concept above, answerable from the reference material.",
  ]);

  return { system, prompt };
}

/** Returns a description of the problem, or null when the question is usable. */
function problemWith(question: GeneratedQuestion, type: QuestionType): string | null {
  if (!question.prompt.trim()) return "empty prompt";

  if (type === "MULTIPLE_CHOICE") {
    const options = question.options ?? [];

    if (options.length < 2) return `only ${options.length} options`;
    if (!question.correctAnswer) return "no correct answer given";
    if (!options.some((option) => option.id === question.correctAnswer)) {
      return "correct answer is not one of the options";
    }
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      return "duplicate option ids";
    }
  }

  return null;
}

function normalise(question: GeneratedQuestion, type: QuestionType): GeneratedQuestion {
  if (type !== "MULTIPLE_CHOICE") {
    return { prompt: question.prompt.trim(), options: null, correctAnswer: null, explanation: null };
  }

  return {
    prompt: question.prompt.trim(),
    options: (question.options ?? []).map((option) => ({ id: option.id.trim(), text: option.text.trim() })),
    correctAnswer: question.correctAnswer!.trim(),
    explanation: question.explanation?.trim() || "See the reference material for the full explanation.",
  };
}

export async function generateQuizQuestion(
  context: { userId: string; projectId: string },
  input: GenerateQuestionInput,
): Promise<GeneratedQuestion> {
  for (const chunk of input.evidence) {
    const signals = detectInjectionSignals(chunk.content);

    if (signals.length > 0) {
      logger.warn(
        {
          projectId: context.projectId,
          materialId: chunk.materialId,
          signals: signals.map((signal) => signal.name),
        },
        "Possible prompt-injection signals in material used for question generation",
      );
    }
  }

  const { system, prompt } = composeQuestionPrompt(input);
  let lastProblem = "no attempt was made";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const question = await aiGenerateStructured({
      context: {
        userId: context.userId,
        projectId: context.projectId,
        feature: AiFeature.QUIZ_GENERATE,
        promptVersion: PROMPT_VERSIONS.quizGeneration,
      },
      schemaName: SCHEMA_NAMES.quizQuestion,
      schema: generatedQuestionSchema,
      system,
      prompt,
      // Some variety across questions, without drifting into nonsense.
      temperature: 0.4,
    });

    const problem = problemWith(question, input.type);

    if (!problem) return normalise(question, input.type);

    lastProblem = problem;
    logger.warn(
      { projectId: context.projectId, attempt, problem, type: input.type },
      "Generated question failed validation; retrying once",
    );
  }

  // Rejected rather than repaired: a question with no valid answer key would corrupt
  // grading and, through it, mastery.
  throw new AiInvalidOutputError(
    `The model did not produce a usable ${input.type} question (${lastProblem}).`,
  );
}
