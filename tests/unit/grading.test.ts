import { describe, expect, it } from "vitest";
import { gradeMultipleChoice } from "@/lib/learning/grading";

describe("gradeMultipleChoice", () => {
  it("scores a matching option as correct", () => {
    expect(gradeMultipleChoice({ selectedOptionId: "b", correctAnswer: "b" })).toEqual({
      isCorrect: true,
      score: 1,
    });
  });

  it("scores a different option as incorrect", () => {
    expect(gradeMultipleChoice({ selectedOptionId: "c", correctAnswer: "b" })).toEqual({
      isCorrect: false,
      score: 0,
    });
  });

  it("compares ids exactly, because they are identifiers rather than prose", () => {
    expect(gradeMultipleChoice({ selectedOptionId: "B", correctAnswer: "b" })?.isCorrect).toBe(false);
  });

  it("refuses to grade when the question has no answer key", () => {
    // Null means the question is malformed. Recording that as a wrong answer would
    // silently punish the learner and drag their mastery down.
    expect(gradeMultipleChoice({ selectedOptionId: "a", correctAnswer: null })).toBeNull();
    expect(gradeMultipleChoice({ selectedOptionId: "a", correctAnswer: "" })).toBeNull();
  });
});
