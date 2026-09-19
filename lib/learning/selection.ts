import type { QuestionTypeValue, QuizModeValue } from "@/lib/learning/quiz";

/**
 * The adaptive selection policy.
 *
 * Prisma-free on purpose: this is the "intelligence" of the quiz generator, and it is
 * far easier to trust when it can be unit-tested directly against hand-built inputs.
 *
 * The policy deliberately does **not** flip difficulty easy↔hard based on correctness
 * (the naive rule the PRD forbids). Difficulty follows the mastery *estimate*, and the
 * ranking follows weakness × importance × neglect × mistake history.
 */

export type ConceptCandidate = {
  id: string;
  name: string;
  /** How central the concept is to the material, 0..1. */
  importance: number;
  /** Current mastery estimate, 0..1. */
  mastery: number;
  /** When this concept was last assessed, if ever. */
  lastPracticedAt: Date | null;
  /** Recent low-scoring observations — the "repeated mistakes" signal. */
  recentMistakes: number;
};

export type QuestionPlan = {
  conceptId: string;
  conceptName: string;
  type: QuestionTypeValue;
  difficulty: number;
  /** Why this question was chosen. Surfaced in diagnostics so the policy is inspectable. */
  reason: string;
};

/** Nobody gets a trivially easy or impossibly hard question. */
export const DIFFICULTY_FLOOR = 0.15;
export const DIFFICULTY_CEILING = 0.9;

/** A concept practised today is deprioritised, but never starved entirely. */
export const RECENCY_RAMP_DAYS = 3;
export const RECENCY_WEIGHT_FLOOR = 0.2;

/** Each recent mistake makes a concept meaningfully more likely to be revisited. */
export const MISTAKE_BOOST = 0.5;

/** Weak concepts get easier questions; strong ones get harder ones. */
export function difficultyForMastery(mastery: number): number {
  const clamped = Math.min(1, Math.max(0, mastery));
  const raw = 0.25 + clamped * 0.6;

  return Number(Math.min(DIFFICULTY_CEILING, Math.max(DIFFICULTY_FLOOR, raw)).toFixed(2));
}

function recencyFactor(lastPracticedAt: Date | null, now: Date): number {
  if (!lastPracticedAt) return 1;

  const ageDays = Math.max(0, (now.getTime() - lastPracticedAt.getTime()) / 86_400_000);

  return Math.min(1, ageDays / RECENCY_RAMP_DAYS);
}

/**
 * Higher means "more worth asking about right now".
 *
 * Exported so the ranking can be asserted directly, not only through `planQuiz`.
 */
export function conceptPriority(candidate: ConceptCandidate, now: Date = new Date()): number {
  const weakness = 1 - Math.min(1, Math.max(0, candidate.mastery));
  const importance = Math.min(1, Math.max(0, candidate.importance));
  const freshness = RECENCY_WEIGHT_FLOOR + (1 - RECENCY_WEIGHT_FLOOR) * recencyFactor(candidate.lastPracticedAt, now);
  const mistakes = 1 + MISTAKE_BOOST * Math.max(0, candidate.recentMistakes);

  return Number((weakness * importance * freshness * mistakes).toFixed(6));
}

function reasonFor(candidate: ConceptCandidate, now: Date): string {
  const reasons: string[] = [];

  if (candidate.mastery < 0.5) reasons.push(`weak (mastery ${Math.round(candidate.mastery * 100)}%)`);
  if (candidate.recentMistakes > 0) reasons.push(`${candidate.recentMistakes} recent mistake(s)`);
  if (candidate.importance >= 0.7) reasons.push("high importance");
  if (!candidate.lastPracticedAt || recencyFactor(candidate.lastPracticedAt, now) >= 1) {
    reasons.push("not practised recently");
  }

  return reasons.length > 0 ? reasons.join(", ") : "revision";
}

/**
 * Ranks concepts and lays out the requested number of questions.
 *
 * When fewer concepts exist than `length`, the ranked list is cycled so the weakest
 * concepts are revisited rather than the quiz being silently short.
 */
export function planQuiz(input: {
  candidates: ConceptCandidate[];
  length: number;
  mode: QuizModeValue;
  now?: Date;
}): QuestionPlan[] {
  const now = input.now ?? new Date();
  const length = Math.max(0, Math.floor(input.length));

  if (length === 0 || input.candidates.length === 0) return [];

  const ranked = [...input.candidates].sort((a, b) => {
    const difference = conceptPriority(b, now) - conceptPriority(a, now);
    // Name is the tie-breaker so the same inputs always produce the same quiz.
    return difference !== 0 ? difference : a.name.localeCompare(b.name);
  });

  // An assessment leans on explanation; a quiz leans on recognition.
  const firstType: QuestionTypeValue =
    input.mode === "ASSESSMENT" ? "OPEN_ENDED" : "MULTIPLE_CHOICE";

  const plans: QuestionPlan[] = [];

  for (let index = 0; index < length; index += 1) {
    const concept = ranked[index % ranked.length]!;

    plans.push({
      conceptId: concept.id,
      conceptName: concept.name,
      type: index % 2 === 0 ? firstType : firstType === "MULTIPLE_CHOICE" ? "OPEN_ENDED" : "MULTIPLE_CHOICE",
      difficulty: difficultyForMastery(concept.mastery),
      reason: reasonFor(concept, now),
    });
  }

  return plans;
}
