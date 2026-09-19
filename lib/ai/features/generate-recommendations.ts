import { AiFeature } from "@prisma/client";
import { aiGenerateStructured } from "@/lib/ai";
import {
  PROMPT_VERSIONS,
  UNTRUSTED_CONTENT_RULES,
  composePrompt,
  detectInjectionSignals,
} from "@/lib/ai/prompts";
import {
  SCHEMA_NAMES,
  recommendationsSchema,
  type RecommendationSuggestion,
} from "@/lib/ai/schemas";
import type { GrowthBand } from "@/lib/learning/growth";
import { logger } from "@/lib/logger";

/**
 * Turns an insight into a next-best action.
 *
 * This is the only place the learner is told what to do, so the prompt pushes hard on
 * two things: every recommendation must cite the specific observation that prompted it,
 * and a short list of high-value actions beats a long one. The model is given the
 * learner's actual state — mastery, trend, performance, known weaknesses — and is told
 * not to invent concepts that are not in it.
 */

export type RecommendationConcept = {
  name: string;
  mastery: number;
  band: GrowthBand;
  evidenceCount: number;
};

export type RecommendInput = {
  project: { name: string; description: string; goal: string };
  concepts: RecommendationConcept[];
  performance: { quizzesCompleted: number; answersGraded: number; averageScore: number | null };
  strengths: string[];
  weaknesses: string[];
  repeatedMistakes: string[];
};

const BAND_LABELS: Record<GrowthBand, string> = {
  IMPROVING: "improving",
  STABLE: "stable",
  NEEDS_ATTENTION: "needs attention",
};

const MAX_CONCEPTS = 20;

/**
 * Concept names and the other context fields are derived from the learner's own
 * documents, so they are untrusted text being placed on their own prompt lines.
 * Flattening them keeps a name from breaking the list structure and impersonating an
 * instruction.
 */
function oneLine(value: string, limit = 120): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function composeRecommendationPrompt(input: RecommendInput): {
  system: string;
  prompt: string;
} {
  const system = composePrompt([
    `You advise a learner on what to study next in their project "${oneLine(input.project.name)}".`,
    "Recommendations must follow from the data given. Do not invent concepts, scores, or events that are not in it.",
    "Each recommendation needs a concrete reason: name the concept and the observation that prompted it, not a generality.",
    "Prefer a few high-value actions over an exhaustive list. Fewer than five is usually better than five.",
    "Prioritise: something the learner is failing at and has not revisited outranks polishing something they are already good at.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const concepts = [...input.concepts]
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, MAX_CONCEPTS);

  const conceptLines = concepts.map(
    (concept) =>
      `- ${oneLine(concept.name)} (mastery ${Math.round(concept.mastery * 100)}%, ${BAND_LABELS[concept.band]}, ${concept.evidenceCount} observations)`,
  );

  const performance =
    input.performance.answersGraded > 0
      ? `${input.performance.answersGraded} answers graded across ${input.performance.quizzesCompleted} completed quizzes, averaging ${Math.round((input.performance.averageScore ?? 0) * 100)}%.`
      : "No assessment history yet.";

  const prompt = composePrompt([
    "Project:",
    `Name: ${oneLine(input.project.name)}`,
    `Goal: ${oneLine(input.project.goal, 300)}`,
    `Assessment history: ${performance}`,
    conceptLines.length > 0
      ? `Concepts, weakest first:\n${conceptLines.join("\n")}`
      : "Concepts: none identified yet.",
    input.weaknesses.length > 0 ? `Known weaknesses: ${input.weaknesses.map((w) => oneLine(w)).join("; ")}` : undefined,
    input.strengths.length > 0 ? `Known strengths: ${input.strengths.map((s) => oneLine(s)).join("; ")}` : undefined,
    input.repeatedMistakes.length > 0
      ? `Repeated mistakes: ${input.repeatedMistakes.map((m) => oneLine(m)).join("; ")}`
      : undefined,
    "Recommend what this learner should do next. For each recommendation, give a short title, what to do and why it helps, the specific evidence that prompted it, a priority from 0 to 1, and the exact name of the concept it concerns (or null if it concerns the project as a whole).",
  ]);

  return { system, prompt };
}

export async function generateRecommendations(
  context: { userId: string; projectId: string },
  input: RecommendInput,
): Promise<RecommendationSuggestion[]> {
  const signals = detectInjectionSignals(
    [...input.concepts.map((concept) => concept.name), ...input.weaknesses, ...input.strengths].join("\n"),
  );

  if (signals.length > 0) {
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals in concept names used for recommendations",
    );
  }

  const { system, prompt } = composeRecommendationPrompt(input);

  const result = await aiGenerateStructured({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.RECOMMEND,
      promptVersion: PROMPT_VERSIONS.recommendations,
    },
    schemaName: SCHEMA_NAMES.recommendations,
    schema: recommendationsSchema,
    system,
    prompt,
    temperature: 0.3,
  });

  return result.recommendations;
}
