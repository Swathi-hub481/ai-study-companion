import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { normaliseExtraction } from "@/lib/ai/features/extract-concepts";
import { SCHEMA_NAMES, conceptExtractionSchema, generatedQuestionSchema, openEndedGradeSchema } from "@/lib/ai/schemas";

/**
 * Guard for a failure mode that is invisible until runtime: strict structured outputs
 * derive a JSON Schema from the Zod schema, and value-changing transforms (`.trim()`,
 * `.toLowerCase()`) cannot be represented there. A schema containing one makes the
 * provider reject the whole request, so every registered schema is checked here.
 */
describe("structured-output schemas", () => {
  it("conceptExtraction is representable as a strict structured-output schema", () => {
    expect(() =>
      zodResponseFormat(conceptExtractionSchema, SCHEMA_NAMES.conceptExtraction),
    ).not.toThrow();
  });

  it("rejects a schema containing a value-changing transform", () => {
    // Documents *why* the rule above exists, so nobody re-adds `.trim()` later.
    const withTransform = z.object({ name: z.string().trim() });
    expect(() => zodResponseFormat(withTransform, "WithTransform")).toThrow();
  });

  it("assessment schemas are representable as strict structured-output schemas", () => {
    // A generated question carries nullable options and answer key (null for an
    // open-ended question). If that cannot be expressed as JSON Schema, the provider
    // rejects the whole request — so it is checked here rather than at run time.
    expect(() =>
      zodResponseFormat(generatedQuestionSchema, SCHEMA_NAMES.quizQuestion),
    ).not.toThrow();
    expect(() =>
      zodResponseFormat(openEndedGradeSchema, SCHEMA_NAMES.openEndedGrade),
    ).not.toThrow();
  });

  it("validates a well-formed extraction", () => {
    const result = conceptExtractionSchema.safeParse({
      concepts: [
        { name: "Backpropagation", description: "Chain rule over a graph.", importance: 0.8, relatedConcepts: [] },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an importance outside 0..1", () => {
    const result = conceptExtractionSchema.safeParse({
      concepts: [{ name: "X", description: "", importance: 1.5, relatedConcepts: [] }],
    });

    expect(result.success).toBe(false);
  });
});

describe("normaliseExtraction", () => {
  const concept = (
    name: string,
    extra: Partial<{ description: string; relatedConcepts: string[] }> = {},
  ) => ({
    name,
    description: extra.description ?? "A description.",
    importance: 0.5,
    relatedConcepts: extra.relatedConcepts ?? [],
  });

  it("collapses whitespace in names and descriptions", () => {
    const result = normaliseExtraction({
      concepts: [concept("  Gradient   descent ", { description: "  Steps down  the gradient.  " })],
    });

    expect(result.concepts[0]?.name).toBe("Gradient descent");
    expect(result.concepts[0]?.description).toBe("Steps down the gradient.");
  });

  it("de-duplicates names case-insensitively", () => {
    // Without this, the second concept would collide with @@unique([projectId, name]).
    const result = normaliseExtraction({
      concepts: [concept("Overfitting"), concept("overfitting"), concept("OVERFITTING")],
    });

    expect(result.concepts).toHaveLength(1);
  });

  it("drops empty names", () => {
    const result = normaliseExtraction({ concepts: [concept("   "), concept("Regularisation")] });

    expect(result.concepts.map((entry) => entry.name)).toEqual(["Regularisation"]);
  });

  it("removes self-references from relatedConcepts", () => {
    const result = normaliseExtraction({
      concepts: [concept("Bias", { relatedConcepts: ["bias", "Variance", "  "] })],
    });

    expect(result.concepts[0]?.relatedConcepts).toEqual(["Variance"]);
  });

  it("handles an empty extraction", () => {
    expect(normaliseExtraction({ concepts: [] }).concepts).toEqual([]);
  });
});
