import { AiFeature } from "@prisma/client";
import { aiGenerateStructured } from "@/lib/ai";
import {
  PROMPT_VERSIONS,
  UNTRUSTED_CONTENT_RULES,
  composePrompt,
  detectInjectionSignals,
  untrustedBlock,
} from "@/lib/ai/prompts";
import { SCHEMA_NAMES, evalGradeSchema, type EvalGrade } from "@/lib/ai/schemas";
import { logger } from "@/lib/logger";

/**
 * Model-based grading for the evaluation harness (§10.5).
 *
 * Some properties of a generated artefact cannot be checked by pattern matching —
 * groundedness and actionability being the two that matter most. Those are graded against
 * a rubric here, and the grade is recorded with its reasoning so a failure explains
 * itself rather than just turning red.
 *
 * This is evaluation infrastructure: it is never on a learner's request path.
 */

export type EvalGradeInput = {
  /** The property being judged, stated as an instruction. */
  criterion: string;
  /** What the artefact was supposed to do. */
  task: string;
  /** The output under evaluation. */
  artefact: string;
  /** Supporting material the artefact should be consistent with. */
  reference?: string;
};

export function composeEvalPrompt(input: EvalGradeInput): { system: string; prompt: string } {
  const system = composePrompt([
    "You evaluate the output of an AI system for a development harness. Your judgement is recorded and compared over time.",
    `Judge only this criterion: ${input.criterion}`,
    "Be strict. A statement that sounds plausible but is not supported by the reference material fails a groundedness criterion, and a generic suggestion that would fit any learner fails an actionability criterion.",
    "Explain the score by referring to the artefact itself, not to how confident you feel.",
    UNTRUSTED_CONTENT_RULES,
  ]);

  const prompt = composePrompt([
    "The task the system was given:",
    untrustedBlock("Task", input.task),
    input.reference ? "Reference material it was allowed to use:" : undefined,
    input.reference ? untrustedBlock("Reference material", input.reference) : undefined,
    "The output produced:",
    untrustedBlock("Output", input.artefact),
    `Score this output against the criterion: ${input.criterion}`,
  ]);

  return { system, prompt };
}

export async function gradeArtefact(
  context: { userId: string; projectId: string },
  input: EvalGradeInput,
): Promise<EvalGrade> {
  const signals = detectInjectionSignals(input.artefact);

  if (signals.length > 0) {
    logger.warn(
      { projectId: context.projectId, signals: signals.map((signal) => signal.name) },
      "Possible prompt-injection signals in an artefact under evaluation",
    );
  }

  const { system, prompt } = composeEvalPrompt(input);

  return aiGenerateStructured({
    context: {
      userId: context.userId,
      projectId: context.projectId,
      feature: AiFeature.EVAL,
      promptVersion: PROMPT_VERSIONS.evalGrading,
    },
    schemaName: SCHEMA_NAMES.evalGrade,
    schema: evalGradeSchema,
    system,
    prompt,
    temperature: 0,
  });
}
