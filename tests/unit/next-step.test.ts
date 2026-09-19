import { describe, expect, it } from "vitest";
import { computeNextStep, type NextStepInput } from "@/lib/learning/next-step";

/**
 * The next-step rules are the product's answer to "what should I do next?" before
 * the AI recommendation engine exists, so their precedence is worth pinning down:
 * a broken material outranks everything, and an unassessed project outranks
 * polishing an already-decent concept.
 */

function input(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    materialCount: 1,
    readyMaterialCount: 1,
    failedMaterialCount: 0,
    conceptCount: 5,
    quizzesCompleted: 2,
    weakestConcept: { name: "Gradient descent", mastery: 0.9 },
    ...overrides,
  };
}

describe("computeNextStep", () => {
  it("prioritises a failed material above everything else", () => {
    const step = computeNextStep(
      input({ failedMaterialCount: 1, materialCount: 0, conceptCount: 0, quizzesCompleted: 0 }),
    );

    expect(step.basis).toBe("materials");
    expect(step.title).toMatch(/failed/i);
  });

  it("asks for material when the project is empty", () => {
    const step = computeNextStep(
      input({ materialCount: 0, readyMaterialCount: 0, conceptCount: 0, quizzesCompleted: 0 }),
    );

    expect(step.basis).toBe("materials");
    expect(step.title).toMatch(/first learning material/i);
  });

  it("reports that processing is still running", () => {
    const step = computeNextStep(
      input({ materialCount: 1, readyMaterialCount: 0, conceptCount: 0, quizzesCompleted: 0 }),
    );

    expect(step.basis).toBe("processing");
  });

  it("suggests exploring when material is ready but no concepts exist", () => {
    const step = computeNextStep(input({ conceptCount: 0, quizzesCompleted: 0 }));

    expect(step.basis).toBe("exploration");
  });

  it("suggests a quiz once concepts exist but nothing has been assessed", () => {
    const step = computeNextStep(input({ quizzesCompleted: 0 }));

    expect(step.basis).toBe("assessment");
    expect(step.title).toMatch(/quiz/i);
  });

  it("names the weakest concept when mastery is low", () => {
    const step = computeNextStep(
      input({ weakestConcept: { name: "Regularisation", mastery: 0.31 } }),
    );

    expect(step.basis).toBe("mastery");
    expect(step.title).toContain("Regularisation");
    expect(step.body).toContain("31%");
  });

  it("does not flag a concept at exactly the 0.6 threshold", () => {
    const step = computeNextStep(
      input({ weakestConcept: { name: "Bias-variance tradeoff", mastery: 0.6 } }),
    );

    expect(step.basis).toBe("exploration");
  });

  it("encourages continuing when nothing needs attention", () => {
    const step = computeNextStep(input());

    expect(step.basis).toBe("exploration");
    expect(step.title).toMatch(/keep going/i);
  });

  it("handles a project with no concepts and no concept to be weak in", () => {
    const step = computeNextStep(
      input({ conceptCount: 3, weakestConcept: null, quizzesCompleted: 1 }),
    );

    // Falls through the mastery rule safely rather than dereferencing null.
    expect(step.basis).toBe("exploration");
  });
});
