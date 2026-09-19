import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CEILING,
  DIFFICULTY_FLOOR,
  conceptPriority,
  difficultyForMastery,
  planQuiz,
  type ConceptCandidate,
} from "@/lib/learning/selection";

const now = new Date("2026-01-15T00:00:00Z");

function candidate(overrides: Partial<ConceptCandidate> = {}): ConceptCandidate {
  return {
    id: "concept-1",
    name: "Gradient descent",
    importance: 0.8,
    mastery: 0.5,
    lastPracticedAt: null,
    recentMistakes: 0,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

describe("difficultyForMastery", () => {
  it("asks easier questions of weaker concepts and harder ones of stronger concepts", () => {
    // This is the phase's stated acceptance criterion: difficulty must respond to mastery.
    expect(difficultyForMastery(0)).toBeLessThan(difficultyForMastery(0.5));
    expect(difficultyForMastery(0.5)).toBeLessThan(difficultyForMastery(1));
  });

  it("stays inside the configured bounds even for out-of-range mastery", () => {
    for (const mastery of [-1, 0, 0.25, 0.75, 1, 2]) {
      expect(difficultyForMastery(mastery)).toBeGreaterThanOrEqual(DIFFICULTY_FLOOR);
      expect(difficultyForMastery(mastery)).toBeLessThanOrEqual(DIFFICULTY_CEILING);
    }
  });
});

describe("conceptPriority", () => {
  it("ranks a weaker concept above a stronger one", () => {
    expect(conceptPriority(candidate({ mastery: 0.1 }), now)).toBeGreaterThan(
      conceptPriority(candidate({ mastery: 0.9 }), now),
    );
  });

  it("ranks a more important concept above a peripheral one", () => {
    expect(conceptPriority(candidate({ importance: 1 }), now)).toBeGreaterThan(
      conceptPriority(candidate({ importance: 0.2 }), now),
    );
  });

  it("deprioritises a concept practised moments ago, without starving it", () => {
    const justPractised = conceptPriority(candidate({ lastPracticedAt: daysAgo(0) }), now);
    const neglected = conceptPriority(candidate({ lastPracticedAt: daysAgo(30) }), now);

    expect(neglected).toBeGreaterThan(justPractised);
    // Still selectable: a floor keeps a recently-served concept from vanishing entirely.
    expect(justPractised).toBeGreaterThan(0);
  });

  it("boosts a concept with recent mistakes", () => {
    expect(conceptPriority(candidate({ recentMistakes: 2 }), now)).toBeGreaterThan(
      conceptPriority(candidate({ recentMistakes: 0 }), now),
    );
  });
});

describe("planQuiz", () => {
  const weak = candidate({ id: "weak", name: "Weak", mastery: 0.1, importance: 0.8 });
  const strong = candidate({ id: "strong", name: "Strong", mastery: 0.9, importance: 0.8 });

  it("returns exactly the requested number of questions", () => {
    expect(planQuiz({ candidates: [weak, strong], length: 2, mode: "QUIZ", now })).toHaveLength(2);
  });

  it("asks about the weakest concept first", () => {
    const plans = planQuiz({ candidates: [strong, weak], length: 1, mode: "QUIZ", now });
    expect(plans[0]?.conceptId).toBe("weak");
  });

  it("sets difficulty from the concept's mastery", () => {
    const plans = planQuiz({ candidates: [weak, strong], length: 2, mode: "QUIZ", now });

    expect(plans[0]?.difficulty).toBe(difficultyForMastery(0.1));
    expect(plans[1]?.difficulty).toBe(difficultyForMastery(0.9));
    expect(plans[0]!.difficulty).toBeLessThan(plans[1]!.difficulty);
  });

  it("starts a quiz with multiple choice and an assessment with open-ended", () => {
    const quiz = planQuiz({ candidates: [weak], length: 1, mode: "QUIZ", now });
    const assessment = planQuiz({ candidates: [weak], length: 1, mode: "ASSESSMENT", now });

    expect(quiz[0]?.type).toBe("MULTIPLE_CHOICE");
    expect(assessment[0]?.type).toBe("OPEN_ENDED");
  });

  it("guarantees both question types once there is more than one question", () => {
    for (const mode of ["QUIZ", "ASSESSMENT"] as const) {
      const plans = planQuiz({ candidates: [weak, strong], length: 2, mode, now });
      expect(new Set(plans.map((plan) => plan.type)).size).toBe(2);
    }
  });

  it("cycles the ranked concepts when fewer are available than questions requested", () => {
    const plans = planQuiz({ candidates: [weak], length: 3, mode: "QUIZ", now });

    expect(plans).toHaveLength(3);
    expect(plans.every((plan) => plan.conceptId === "weak")).toBe(true);
  });

  it("returns nothing when there is nothing to ask about", () => {
    expect(planQuiz({ candidates: [], length: 3, mode: "QUIZ", now })).toEqual([]);
    expect(planQuiz({ candidates: [weak], length: 0, mode: "QUIZ", now })).toEqual([]);
  });
});
