import { describe, expect, it } from "vitest";
import { fromNextStep, fromRecommendation } from "@/lib/learning/next-action";
import type { NextStep } from "@/lib/learning/next-step";

describe("fromRecommendation", () => {
  it("uses the recommendation's own reason as the basis", () => {
    const action = fromRecommendation({
      title: "Review gradient descent",
      body: "Revisit the notes, then take a short quiz.",
      reason: "Gradient descent is your weakest concept at 12%.",
      priority: 0.8,
    });

    expect(action.basis).toBe("Gradient descent is your weakest concept at 12%.");
    expect(action.source).toBe("recommendation");
    expect(action.priority).toBe(0.8);
  });

  it("falls back to a generic basis when no reason was recorded", () => {
    const action = fromRecommendation({
      title: "Take a quiz",
      body: "Check what has stuck.",
      reason: null,
      priority: 0.5,
    });

    expect(action.basis).toBe("Based on your recent performance");
  });

  it("treats a blank reason as missing", () => {
    const action = fromRecommendation({
      title: "Take a quiz",
      body: "Check what has stuck.",
      reason: "   ",
      priority: 0.5,
    });

    expect(action.basis).toBe("Based on your recent performance");
  });
});

describe("fromNextStep", () => {
  it("translates the heuristic's basis into a sentence a learner can read", () => {
    const step: NextStep = {
      title: "Add your first learning material",
      body: "Upload a PDF for this Project.",
      basis: "materials",
    };

    const action = fromNextStep(step);

    expect(action.basis).toBe("Based on your materials");
    expect(action.source).toBe("heuristic");
    expect(action.priority).toBeNull();
  });

  it("covers every heuristic basis", () => {
    const bases: NextStep["basis"][] = [
      "materials",
      "processing",
      "assessment",
      "mastery",
      "exploration",
    ];

    for (const basis of bases) {
      const action = fromNextStep({ title: "t", body: "b", basis });
      expect(action.basis.length).toBeGreaterThan(0);
      expect(action.basis).not.toBe(basis);
    }
  });
});
