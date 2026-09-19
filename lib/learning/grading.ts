/**
 * Deterministic grading for multiple-choice answers.
 *
 * Deliberately model-free. An MCQ has an unambiguous answer key, so asking a model to
 * grade it would add latency, cost, and a chance of being wrong for no benefit. This is
 * the "cost control" the architecture calls for: every MCQ in a quiz is free to grade.
 */

export type MultipleChoiceGrade = {
  isCorrect: boolean;
  score: number;
};

/**
 * Compares a submitted option id against the answer key.
 *
 * Returns `null` when the question has no usable key — generation requires one, so this
 * signals a malformed question rather than a wrong answer, and the caller must not
 * silently record it as a failure.
 */
export function gradeMultipleChoice(input: {
  selectedOptionId: string;
  correctAnswer: string | null;
}): MultipleChoiceGrade | null {
  if (!input.correctAnswer) return null;

  const isCorrect = input.selectedOptionId === input.correctAnswer;

  return { isCorrect, score: isCorrect ? 1 : 0 };
}
