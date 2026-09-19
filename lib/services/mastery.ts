import type { PrismaClient } from "@prisma/client";
import { computeMastery, MASTERY_EVIDENCE_LIMIT } from "@/lib/learning/mastery";
import { prisma } from "@/lib/db";
import { rebuildLearningContext, type RebuiltContext } from "@/lib/services/learning-context";

/**
 * Mastery persistence.
 *
 * The formula lives in `lib/learning/mastery.ts` and is pure; this module is the thin
 * layer that reads the evidence, applies it, and writes the derived value back onto the
 * Concept. Shared by the answer path and the `quiz.evaluate` job so both agree.
 */

export type MasteryDb = Pick<PrismaClient, "concept" | "conceptEvidence">;

export type MasteryChange = {
  conceptId: string;
  before: number;
  after: number;
};

/** Recomputes one concept's mastery from its evidence and stores the result. */
export async function recomputeConceptMastery(
  db: MasteryDb,
  conceptId: string,
  now: Date = new Date(),
): Promise<MasteryChange> {
  const concept = await db.concept.findUnique({
    where: { id: conceptId },
    select: { mastery: true },
  });

  // Deleted mid-flight (the question's concept is SetNull on delete) — nothing to do.
  if (!concept) return { conceptId, before: 0, after: 0 };

  const evidence = await db.conceptEvidence.findMany({
    where: { conceptId },
    orderBy: { createdAt: "desc" },
    take: MASTERY_EVIDENCE_LIMIT,
    select: { score: true, weight: true, createdAt: true },
  });

  const after = computeMastery(evidence, now);

  // Only write when the value actually moves, so MASTERY_UPDATED means something.
  if (after !== concept.mastery) {
    await db.concept.update({ where: { id: conceptId }, data: { mastery: after } });
  }

  return { conceptId, before: concept.mastery, after };
}

export type RefreshedMastery = {
  concepts: number;
  changed: number;
  context: RebuiltContext;
};

/**
 * The `mastery.update` job body.
 *
 * §9 gives this job two effects: recompute mastery from evidence, and refresh
 * `LearningContext`. Both are derived, so re-running it is safe and produces the same
 * values — which is what makes it a valid retry target.
 */
export async function refreshProjectMastery(projectId: string): Promise<RefreshedMastery> {
  const concepts = await prisma.concept.findMany({
    where: { projectId },
    select: { id: true },
  });

  let changed = 0;

  for (const concept of concepts) {
    const change = await recomputeConceptMastery(prisma, concept.id);
    if (change.before !== change.after) changed += 1;
  }

  const context = await rebuildLearningContext(projectId);

  return { concepts: concepts.length, changed, context };
}
