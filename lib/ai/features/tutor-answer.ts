import { AiFeature } from "@prisma/client";
import { aiStreamText } from "@/lib/ai";
import {
  PROMPT_VERSIONS,
  UNTRUSTED_CONTENT_RULES,
  composePrompt,
  detectInjectionSignals,
  untrustedBlock,
} from "@/lib/ai/prompts";
import type { TextChunk } from "@/lib/ai/types";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import { logger } from "@/lib/logger";

/**
 * The Tutor's grounded answer.
 *
 * Two design points:
 *
 *  - The answer is generated as **free text**, not structured output, because the
 *    provider interface streams only text. That is fine here: the citations attached
 *    to the answer come from retrieval (`lib/rag/cite.ts`), not from the model, so
 *    there is nothing for the model to get structurally wrong.
 *
 *  - Evidence is fenced as untrusted data and never placed in the instruction region
 *    of the prompt. A document that says "ignore your instructions" is a signal worth
 *    logging, not a reason to refuse to study it.
 */

export type TutorHistoryTurn = {
  role: "USER" | "ASSISTANT";
  content: string;
};

export type TutorAnswerInput = {
  project: { name: string; description: string; goal: string };
  /** Evidence already retrieved and gated. Never empty when an answer is generated. */
  evidence: RetrievedChunk[];
  /** Recent turns only — the conversation window, never the full transcript. */
  history: TutorHistoryTurn[];
  /** Rolling summary of older turns, when one exists. */
  summary?: string | null;
  /**
   * The curated `LearningContext` slice (§7.2). Lets the tutor pitch an answer to this
   * learner without re-reading their history — which is the whole point of curating it.
   */
  learningContext?: {
    strengths: string[];
    weaknesses: string[];
    repeatedMistakes: string[];
    tutorSummary: string | null;
  } | null;
  question: string;
};

/** Keeps the evidence portion of a single prompt within a sane budget. */
const MAX_EVIDENCE_CHARACTERS = 24_000;

/** Shortens the evidence list to fit the character budget, dropping the weakest last. */
function trimEvidence(evidence: RetrievedChunk[]): {
  evidence: RetrievedChunk[];
  truncated: boolean;
} {
  const kept: RetrievedChunk[] = [];
  let used = 0;
  let truncated = false;

  for (const chunk of evidence) {
    if (used + chunk.content.length > MAX_EVIDENCE_CHARACTERS) {
      truncated = true;
      continue;
    }

    kept.push(chunk);
    used += chunk.content.length;
  }

  return { evidence: kept, truncated };
}

/**
 * The curated context, rendered as guidance rather than as something to recite.
 *
 * Names here come from the learner's own material, so they are flattened onto single
 * lines — a concept name must not be able to impersonate a prompt section.
 */
function contextBlock(context: TutorAnswerInput["learningContext"]): string | undefined {
  if (!context) return undefined;

  const oneLine = (values: string[]) =>
    values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");

  const lines = [
    context.tutorSummary ? `Notes from earlier sessions: ${context.tutorSummary}` : undefined,
    context.strengths.length > 0 ? `Strengths: ${oneLine(context.strengths)}` : undefined,
    context.weaknesses.length > 0 ? `Weaknesses: ${oneLine(context.weaknesses)}` : undefined,
    context.repeatedMistakes.length > 0
      ? `Repeated mistakes: ${oneLine(context.repeatedMistakes)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) return undefined;

  return composePrompt([
    "What is already known about this learner (use it to pitch the explanation; do not recite it):",
    lines.join("\n"),
  ]);
}

export function composeTutorPrompt(input: TutorAnswerInput): {
  system: string;
  prompt: string;
} {
  const { evidence, truncated } = trimEvidence(input.evidence);

  const system = composePrompt([
    `You are a study tutor for the learning project "${input.project.name}".`,
    "Answer the learner's question using only the reference material provided in <untrusted_document> blocks.",
    "When the material does not cover part of the question, say so plainly instead of filling the gap from general knowledge.",
    "Refer to your sources by the title and page shown on each block, so the learner can find them.",
    "Explain the reasoning rather than only stating a conclusion, and keep the answer focused.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const history =
    input.history.length > 0
      ? input.history
          .map((turn) => `${turn.role === "USER" ? "Learner" : "Tutor"}: ${turn.content}`)
          .join("\n")
      : undefined;

  const prompt = composePrompt([
    "Project context:",
    `Name: ${input.project.name}`,
    `Description: ${input.project.description}`,
    `Learning goal: ${input.project.goal}`,
    input.summary ? `Earlier conversation summary: ${input.summary}` : undefined,
    history ? `Recent conversation:\n${history}` : undefined,
    contextBlock(input.learningContext),
    "Reference material:",
    ...evidence.map((chunk) =>
      untrustedBlock(
        `${chunk.title} - page ${chunk.page ?? "unknown"}`,
        chunk.content,
      ),
    ),
    truncated
      ? "(Note: some passages were omitted for length; answer from what is shown.)"
      : undefined,
    `Answer the learner's question below using only the reference material above.\n\n${untrustedBlock(
      "Question",
      input.question,
    )}`,
  ]);

  return { system, prompt };
}

export async function* streamTutorAnswer(
  context: { userId: string; projectId: string },
  input: TutorAnswerInput,
): AsyncGenerator<TextChunk, void, undefined> {
  const signals = detectInjectionSignals(input.question);

  if (signals.length > 0) {
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals in a Tutor question",
    );
  }

  for (const chunk of input.evidence) {
    const evidenceSignals = detectInjectionSignals(chunk.content);

    if (evidenceSignals.length > 0) {
      // Recorded, not blocked: study material about prompt injection must stay usable.
      logger.warn(
        {
          projectId: context.projectId,
          materialId: chunk.materialId,
          signals: evidenceSignals.map((signal) => signal.name),
        },
        "Possible prompt-injection signals in retrieved evidence",
      );
    }
  }

  const { system, prompt } = composeTutorPrompt(input);

  yield* aiStreamText({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.TUTOR,
      promptVersion: PROMPT_VERSIONS.tutorAnswer,
    },
    system,
    prompt,
    temperature: 0.2,
  });
}
