import { z } from "zod";
import { QUIZ_LENGTH_MAX, QUIZ_LENGTH_MIN } from "@/lib/learning/quiz";

/** Starting a quiz. Length is bounded so one request cannot generate an unbounded set. */
export const quizCreateSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  mode: z.enum(["QUIZ", "ASSESSMENT"]).optional(),
  length: z.coerce
    .number()
    .int()
    .min(QUIZ_LENGTH_MIN, `A quiz needs at least ${QUIZ_LENGTH_MIN} question.`)
    .max(QUIZ_LENGTH_MAX, `A quiz can have at most ${QUIZ_LENGTH_MAX} questions.`)
    .optional(),
});

export const quizListQuerySchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
});

/**
 * `answer` is either a multiple-choice option id or free text. Validation only bounds
 * the size; interpreting it is the grader's job.
 */
export const quizAnswerSchema = z.object({
  questionId: z.string().min(1, "questionId is required."),
  answer: z.string().trim().min(1, "Provide an answer.").max(4000, "That answer is too long."),
});

export type QuizCreateInput = z.infer<typeof quizCreateSchema>;
export type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;
