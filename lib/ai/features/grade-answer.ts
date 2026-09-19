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
  openEndedGradeSchema,
  type OpenEndedGrade,
} from "@/lib/ai/schemas";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import { logger } from "@/lib/logger";

/**
 * Rubric grading for open-ended answers.
 *
 * The rubric is deliberately multi-dimensional (understanding, accuracy, relevance)
 * rather than a single score, because the point of the feedback is to tell the learner
 * *what* fell short. The three dimensions are collapsed into one stored score by the
 * caller; the model's `reasoning` is kept for audit, and `feedback` is what the learner
 * reads.
 *
 * Both the learner's answer and the reference material are untrusted input and are
 * fenced accordingly — an answer is exactly the kind of place someone would try to
 * smuggle instructions.
 */

export type GradeAnswerInput = {
  project: { name: string; description: string; goal: string };
  concept: { name: string; description: string | null } | null;
  question: { prompt: string; difficulty: number };
  answer: string;
  evidence: RetrievedChunk[];
};

const MAX_EVIDENCE_CHARACTERS = 12_000;

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

export function composeGradingPrompt(input: GradeAnswerInput): {
  system: string;
  prompt: string;
} {
  const evidence = trimEvidence(input.evidence);

  const system = composePrompt([
    `You grade short written answers for the learning project "${input.project.name}".`,
    "Judge the answer only against the reference material. Do not reward facts the material does not contain, and do not penalise an answer for omitting something the question did not ask for.",
    "Score three dimensions from 0 to 1: understanding (did they grasp the idea), accuracy (is what they said correct), and relevance (did they answer the question that was asked).",
    "Name the concepts the answer demonstrates, and the concepts a complete answer would have included but this one did not.",
    "The feedback is the most important field: it is shown to the learner, and it must name specifically what they got right and what is missing or wrong, and why. Never write only a score, a grade, or a restatement of the correct answer.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const prompt = composePrompt([
    "Project context:",
    `Name: ${input.project.name}`,
    `Description: ${input.project.description}`,
    `Learning goal: ${input.project.goal}`,
    input.concept ? `Concept: ${input.concept.name}` : undefined,
    input.concept?.description ? `Concept description: ${input.concept.description}` : undefined,
    `Question difficulty: ${input.question.difficulty.toFixed(2)}`,
    "The question:",
    untrustedBlock("Question", input.question.prompt),
    "The learner's answer:",
    untrustedBlock("Learner answer", input.answer),
    "Reference material:",
    ...evidence.map((chunk) =>
      untrustedBlock(`${chunk.title} - page ${chunk.page ?? "unknown"}`, chunk.content),
    ),
    "Grade the answer now, following the rubric.",
  ]);

  return { system, prompt };
}

export async function gradeOpenEndedAnswer(
  context: { userId: string; projectId: string },
  input: GradeAnswerInput,
): Promise<OpenEndedGrade> {
  const signals = detectInjectionSignals(input.answer);

  if (signals.length > 0) {
    // Recorded, not blocked: a learner may legitimately write about prompt injection.
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals in a quiz answer",
    );
  }

  const { system, prompt } = composeGradingPrompt(input);

  return aiGenerateStructured({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.ANSWER_GRADE,
      promptVersion: PROMPT_VERSIONS.answerGrading,
    },
    schemaName: SCHEMA_NAMES.openEndedGrade,
    schema: openEndedGradeSchema,
    system,
    prompt,
    temperature: 0.2,
  });
}
