/**
 * Assessment vocabulary.
 *
 * Deliberately free of Prisma and server imports, so question cards and results can be
 * rendered from these types without pulling the database or the AI layer into the
 * browser bundle — the boundary eslint.config.mjs enforces for `components/**`.
 */

export type QuizModeValue = "QUIZ" | "ASSESSMENT";
export type QuizStatusValue = "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
export type QuestionTypeValue = "MULTIPLE_CHOICE" | "OPEN_ENDED";

/** Multiple-choice option. `id` is what gets submitted and compared. */
export type QuizOption = {
  id: string;
  text: string;
};

/** The outcome of one answered question. */
export type AnswerResultView = {
  isCorrect: boolean | null;
  score: number | null;
  /** Names what was understood and what is missing — never only a number. */
  feedback: string | null;
  conceptsCovered: string[];
  conceptsMissing: string[];
  /** Revealed only once the question has been answered. */
  correctAnswer: string | null;
  gradedBy: string;
};

/**
 * A question as presented to the learner. The answer key is absent until `answer`
 * exists, so an in-progress quiz cannot leak its own solutions.
 */
export type QuizQuestionView = {
  id: string;
  ord: number;
  type: QuestionTypeValue;
  difficulty: number;
  prompt: string;
  conceptName: string | null;
  options: QuizOption[];
  answer: AnswerResultView | null;
};

export type QuizView = {
  id: string;
  projectId: string;
  mode: QuizModeValue;
  status: QuizStatusValue;
  title: string | null;
  startedAt: string;
  completedAt: string | null;
  questions: QuizQuestionView[];
};

/** Row shape for the quiz list. */
export type QuizSummary = {
  id: string;
  mode: QuizModeValue;
  status: QuizStatusValue;
  title: string | null;
  startedAt: string;
  completedAt: string | null;
  questionCount: number;
  answeredCount: number;
  averageScore: number | null;
};

/** Score at or above this counts as a correct answer. */
export const ANSWER_PASS_THRESHOLD = 0.6;

export const QUIZ_LENGTH_MIN = 1;
export const QUIZ_LENGTH_MAX = 6;
export const QUIZ_LENGTH_DEFAULT = 3;
