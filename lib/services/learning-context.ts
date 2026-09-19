import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { summarizeForContext } from "@/lib/ai/features/summarize-context";
import { getGrowthForProject } from "@/lib/services/growth";

/**
 * The curated `LearningContext` record.
 *
 * §6.3: one row per project, holding "curated JSON: goals, strengths, weaknesses,
 * preferences, repeated mistakes, and a short 'significant tutor context' summary —
 * **never the raw transcript**".
 *
 * Everything except `tutorSummary` is derived deterministically from the same evidence
 * the Growth view reads, so the two can never disagree. `preferences` has no signal
 * source in this phase and is deliberately left untouched rather than invented.
 */

/** Idempotency keys for the jobs that rebuild this record. */
export const CONTEXT_JOB_IDS = {
  forQuiz: (projectId: string, quizId: string) => `context:${projectId}:quiz:${quizId}`,
};

export type ContextSlice = {
  goal: string | null;
  description: string | null;
  strengths: string[];
  weaknesses: string[];
  repeatedMistakes: string[];
  tutorSummary: string | null;
};

/** Concepts at or above this are worth calling a strength. */
const STRENGTH_THRESHOLD = 0.7;

/** Below this, a concept is a weakness regardless of whether it is improving. */
const WEAKNESS_THRESHOLD = 0.4;

const MISTAKE_WINDOW_DAYS = 30;
const MISTAKE_SCORE_THRESHOLD = 0.5;
const MISTAKE_MIN_COUNT = 2;

const MAX_NAMED = 8;
const MAX_SUMMARY_TURNS = 10;

/** The model is asked to stay short; this is the guarantee, since the schema cannot be. */
const TUTOR_SUMMARY_MAX = 600;

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readGoal(value: Prisma.JsonValue | null | undefined): { goal: string | null; description: string | null } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      goal: typeof record.goal === "string" ? record.goal : null,
      description: typeof record.description === "string" ? record.description : null,
    };
  }

  return { goal: null, description: null };
}

/** Reads the stored slice, for prompts and views. */
export async function getContextSlice(projectId: string): Promise<ContextSlice> {
  const record = await prisma.learningContext.findUnique({ where: { projectId } });
  const { goal, description } = readGoal(record?.goals);

  return {
    goal,
    description,
    strengths: toStringArray(record?.strengths),
    weaknesses: toStringArray(record?.weaknesses),
    repeatedMistakes: toStringArray(record?.repeatedMistakes),
    tutorSummary: record?.tutorSummary ?? null,
  };
}

export type RebuiltContext = {
  strengths: number;
  weaknesses: number;
  repeatedMistakes: number;
  summarised: boolean;
};

/**
 * Rebuilds the curated slice for a project.
 *
 * Idempotent: every field is recomputed from the evidence, so running it twice produces
 * the same record. `tutorSummary` keeps its previous value when there is no conversation
 * to summarise — an empty summary would be a silent loss of context.
 */
export async function rebuildLearningContext(projectId: string): Promise<RebuiltContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, goal: true, spaceId: true, space: { select: { userId: true } } },
  });

  if (!project) return { strengths: 0, weaknesses: 0, repeatedMistakes: 0, summarised: false };

  const since = new Date(Date.now() - MISTAKE_WINDOW_DAYS * 86_400_000);

  const [growth, mistakeRows, conversation] = await Promise.all([
    getGrowthForProject(projectId),
    prisma.conceptEvidence.groupBy({
      by: ["conceptId"],
      where: { projectId, createdAt: { gte: since }, score: { lt: MISTAKE_SCORE_THRESHOLD } },
      _count: { _all: true },
    }),
    prisma.conversation.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { messages: { orderBy: { createdAt: "desc" }, take: MAX_SUMMARY_TURNS, select: { role: true, content: true } } },
    }),
  ]);

  const mistakeConceptIds = new Set(
    mistakeRows.filter((row) => row._count._all >= MISTAKE_MIN_COUNT).map((row) => row.conceptId),
  );

  const strengths = growth
    .filter((concept) => concept.mastery >= STRENGTH_THRESHOLD)
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, MAX_NAMED)
    .map((concept) => concept.name);

  const weaknesses = growth
    .filter((concept) => concept.mastery < WEAKNESS_THRESHOLD)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, MAX_NAMED)
    .map((concept) => concept.name);

  const repeatedMistakes = growth
    .filter((concept) => mistakeConceptIds.has(concept.conceptId))
    .slice(0, MAX_NAMED)
    .map((concept) => concept.name);

  const turns = (conversation?.messages ?? [])
    .slice()
    .reverse()
    .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
    .map((message) => ({ role: message.role as "USER" | "ASSISTANT", content: message.content }));

  let tutorSummary: string | undefined;
  let summarised = false;

  if (turns.length > 0) {
    const summary = await summarizeForContext(
      { userId: project.space.userId, projectId },
      {
        project: { name: project.name, goal: project.goal },
        concepts: growth.map((concept) => ({
          name: concept.name,
          mastery: concept.mastery,
          band: concept.band,
        })),
        tutorTurns: turns,
      },
    );

    tutorSummary = summary.summary.slice(0, TUTOR_SUMMARY_MAX);
    summarised = true;
  }

  await prisma.learningContext.upsert({
    where: { projectId },
    create: {
      projectId,
      goals: { goal: project.goal, description: project.description },
      strengths,
      weaknesses,
      repeatedMistakes,
      tutorSummary: tutorSummary ?? null,
    },
    update: {
      goals: { goal: project.goal, description: project.description },
      strengths,
      weaknesses,
      repeatedMistakes,
      ...(tutorSummary !== undefined ? { tutorSummary } : {}),
    },
  });

  return {
    strengths: strengths.length,
    weaknesses: weaknesses.length,
    repeatedMistakes: repeatedMistakes.length,
    summarised,
  };
}
