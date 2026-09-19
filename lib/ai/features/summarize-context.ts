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
  contextSummarySchema,
  type ContextSummary,
} from "@/lib/ai/schemas";
import type { GrowthBand } from "@/lib/learning/growth";
import { logger } from "@/lib/logger";

/**
 * Compresses a thread into notes worth keeping.
 *
 * §6.3 is explicit that `LearningContext` holds a short summary and "never the raw
 * transcript", and §10.3 that full history is never sent to a model. This is the
 * feature that makes that possible: the conversation is read once, summarised, and the
 * summary is what persists.
 *
 * The turns are the learner's own words, so they are fenced as untrusted and the prompt
 * requires the output to be a summary rather than quotes.
 */

export type SummarizeContextInput = {
  project: { name: string; goal: string };
  concepts: Array<{ name: string; mastery: number; band: GrowthBand }>;
  tutorTurns: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
};

const MAX_TURN_CHARACTERS = 1_500;

const BAND_LABELS: Record<GrowthBand, string> = {
  IMPROVING: "improving",
  STABLE: "stable",
  NEEDS_ATTENTION: "needs attention",
};

export function composeContextPrompt(input: SummarizeContextInput): {
  system: string;
  prompt: string;
} {
  const system = composePrompt([
    `You keep notes about a learner for their project "${input.project.name}".`,
    "The notes are read later by a tutor that will not have the conversation itself, so they must be self-contained.",
    "Record what the learner has covered, where they struggled or were confused, and anything about how they prefer to be taught.",
    "Summarise; never quote or reproduce the conversation, and never list raw messages.",
    "Keep it short and factual. If the material below shows nothing worth remembering, still return the most useful one or two observations.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const conceptLines = input.concepts
    .slice(0, 20)
    .sort((a, b) => a.mastery - b.mastery)
    .map(
      (concept) =>
        `- ${concept.name.replace(/\s+/g, " ").slice(0, 120)} (mastery ${Math.round(concept.mastery * 100)}%, ${BAND_LABELS[concept.band]})`,
    );

  const turns = input.tutorTurns
    .slice(-10)
    .map((turn) => `${turn.role === "USER" ? "Learner" : "Tutor"}: ${turn.content.slice(0, MAX_TURN_CHARACTERS)}`)
    .join("\n");

  const prompt = composePrompt([
    `Project goal: ${input.project.goal}`,
    conceptLines.length > 0 ? `Concepts and mastery:\n${conceptLines.join("\n")}` : undefined,
    turns
      ? `Recent tutoring conversation:\n${untrustedBlock("Tutoring conversation", turns)}`
      : "No tutoring conversation has taken place yet.",
    "Write the notes now.",
  ]);

  return { system, prompt };
}

export async function summarizeForContext(
  context: { userId: string; projectId: string },
  input: SummarizeContextInput,
): Promise<ContextSummary> {
  const conversation = input.tutorTurns.map((turn) => turn.content).join("\n");
  const signals = detectInjectionSignals(conversation);

  if (signals.length > 0) {
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals in conversation used for context summarisation",
    );
  }

  const { system, prompt } = composeContextPrompt(input);

  return aiGenerateStructured({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.GROWTH_INSIGHT,
      promptVersion: PROMPT_VERSIONS.contextSummary,
    },
    schemaName: SCHEMA_NAMES.contextSummary,
    schema: contextSummarySchema,
    system,
    prompt,
    temperature: 0.2,
  });
}
