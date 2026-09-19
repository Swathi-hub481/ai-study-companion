/**
 * The "what should I do next?" rule engine.
 *
 * Kept in its own Prisma-free module for two reasons: presentation components can
 * import the `NextStep` type without reaching into a server service, and the rules
 * can be unit-tested directly.
 */

export type NextStep = {
  title: string;
  body: string;
  /** Why this was suggested. Surfaced in the UI so the reasoning is inspectable. */
  basis: "materials" | "processing" | "assessment" | "mastery" | "exploration";
};

export type NextStepInput = {
  materialCount: number;
  readyMaterialCount: number;
  failedMaterialCount: number;
  conceptCount: number;
  quizzesCompleted: number;
  weakestConcept: { name: string; mastery: number } | null;
};

/** Concepts at or above this are not worth flagging for review. */
export const MASTERY_REVIEW_THRESHOLD = 0.6;

/**
 * A deterministic next step derived from the Project's actual state.
 *
 * Deliberately rule-based: it is honest about being a heuristic, costs nothing, and
 * gives the dashboard something useful before the AI recommendation engine exists.
 * When that lands, these rules become the fallback when no generated recommendation
 * is available.
 */
export function computeNextStep(input: NextStepInput): NextStep {
  if (input.failedMaterialCount > 0) {
    return {
      title: "Reprocess a failed material",
      body: "One of your uploaded documents could not be processed. Re-upload or retry it so the Tutor can use it as evidence.",
      basis: "materials",
    };
  }

  if (input.materialCount === 0) {
    return {
      title: "Add your first learning material",
      body: "Upload a PDF for this Project. Grounded answers and adaptive quizzes both depend on having material to draw from.",
      basis: "materials",
    };
  }

  if (input.readyMaterialCount === 0) {
    return {
      title: "Your material is still processing",
      body: "Document processing runs in the background. You can leave this page — nothing is lost.",
      basis: "processing",
    };
  }

  if (input.conceptCount === 0) {
    return {
      title: "Explore the material with the Tutor",
      body: "No concepts have been identified yet. Ask the Tutor a question about the material to start building your knowledge map.",
      basis: "exploration",
    };
  }

  if (input.quizzesCompleted === 0) {
    return {
      title: "Take a short quiz",
      body: "You have material ready but no assessment history yet. A short quiz establishes your baseline mastery.",
      basis: "assessment",
    };
  }

  if (input.weakestConcept && input.weakestConcept.mastery < MASTERY_REVIEW_THRESHOLD) {
    return {
      title: `Review ${input.weakestConcept.name}`,
      body: `Your mastery of ${input.weakestConcept.name} is the weakest in this Project (${Math.round(
        input.weakestConcept.mastery * 100,
      )}%). Revisit the related material, then take another short assessment.`,
      basis: "mastery",
    };
  }

  return {
    title: "Keep going",
    body: "Your mastery is holding up across this Project's concepts. Continue with the next topic or push into harder questions.",
    basis: "exploration",
  };
}
