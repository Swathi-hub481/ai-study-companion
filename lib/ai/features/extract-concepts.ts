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
  conceptExtractionSchema,
  type ConceptExtraction,
} from "@/lib/ai/schemas";
import { logger } from "@/lib/logger";

/**
 * Extract the concepts a learner should take from a piece of material.
 *
 * The document text is fenced as untrusted data and never placed in the instruction
 * region of the prompt. Apparent injection attempts are logged rather than blocked,
 * because pattern matching is a weak defence and the real boundary is that the model
 * can only affect the application through validated, permission-checked services.
 */

export type ExtractConceptsInput = {
  /** Material title, used as the fence label so citations remain traceable. */
  materialTitle: string;
  /** Plain text of the document, already extracted from the source file. */
  text: string;
};

/** Keeps a single extraction request within a sane prompt budget. */
const MAX_CHARACTERS = 24_000;

/**
 * Cleans up what the model returned.
 *
 * Normalisation happens here rather than in the Zod schema because value-changing
 * transforms cannot be expressed in the JSON Schema that strict structured outputs
 * are built from — including one makes the provider reject the request.
 *
 * De-duplication matters: a model that repeats a concept would otherwise collide
 * with the `@@unique([projectId, name])` constraint on Concept at insert time.
 */
export function normaliseExtraction(extraction: ConceptExtraction): ConceptExtraction {
  const seen = new Set<string>();
  const concepts: ConceptExtraction["concepts"] = [];

  for (const concept of extraction.concepts) {
    const name = concept.name.trim().replace(/\s+/g, " ");

    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    concepts.push({
      ...concept,
      name,
      description: concept.description.trim().replace(/\s+/g, " "),
      relatedConcepts: concept.relatedConcepts
        .map((related) => related.trim().replace(/\s+/g, " "))
        .filter((related) => related.length > 0 && related.toLowerCase() !== key),
    });
  }

  return { concepts };
}

export async function extractConcepts(
  context: { userId: string; projectId: string },
  input: ExtractConceptsInput,
): Promise<ConceptExtraction> {
  const signals = detectInjectionSignals(input.text);

  if (signals.length > 0) {
    // Recorded, not blocked: legitimate study material about prompt injection would
    // otherwise be impossible to process.
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals found in learning material",
    );
  }

  const truncated = input.text.length > MAX_CHARACTERS;
  const body = truncated ? input.text.slice(0, MAX_CHARACTERS) : input.text;

  const system = composePrompt([
    "You are a curriculum analyst. You identify the concepts a learner should take away from study material.",
    "Return only the concepts that the material actually covers. Do not invent topics.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const prompt = composePrompt([
    "Identify the key concepts in the study material below.",
    "For each concept, give a short name, a one or two sentence description, an importance between 0 and 1, and the names of any other concepts in your list that it relates to.",
    "Prefer a small number of genuinely distinct concepts over an exhaustive list of topics.",
    truncated
      ? "(Note: the document was truncated for length; describe only what is present.)"
      : undefined,
    untrustedBlock(input.materialTitle, body),
  ]);

  const extraction = await aiGenerateStructured({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.CONCEPT_EXTRACT,
      promptVersion: PROMPT_VERSIONS.conceptExtraction,
    },
    schemaName: SCHEMA_NAMES.conceptExtraction,
    schema: conceptExtractionSchema,
    system,
    prompt,
    temperature: 0.2,
  });

  return normaliseExtraction(extraction);
}
