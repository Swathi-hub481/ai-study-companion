import { prisma } from "@/lib/db";
import { assertProjectAccess } from "@/lib/auth/guards";
import { classifyGrowth, masterySeries, type ConceptGrowth } from "@/lib/learning/growth";
import type { MasteryEvidence } from "@/lib/learning/mastery";

/**
 * Growth, read from the evidence time series.
 *
 * Classification itself lives in `lib/learning/growth.ts` and is pure; this is the thin
 * layer that assembles the evidence. Shared with the recommendation job, which has no
 * request context, so the unguarded variant is exported separately.
 */

/** Bounds the scan; a concept's recent history is what matters, not its whole archive. */
const EVIDENCE_SCAN_LIMIT = 1_000;

export type { ConceptGrowth };

export async function getProjectGrowth(
  userId: string,
  projectId: string,
): Promise<ConceptGrowth[]> {
  const project = await assertProjectAccess(userId, projectId);

  return getGrowthForProject(project.id);
}

export async function getGrowthForProject(projectId: string): Promise<ConceptGrowth[]> {
  const [concepts, evidence] = await Promise.all([
    prisma.concept.findMany({
      where: { projectId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.conceptEvidence.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: EVIDENCE_SCAN_LIMIT,
      select: { conceptId: true, score: true, weight: true, createdAt: true },
    }),
  ]);

  const byConcept = new Map<string, MasteryEvidence[]>();

  for (const row of evidence) {
    const rows = byConcept.get(row.conceptId) ?? [];
    rows.push({ score: row.score, weight: row.weight, createdAt: row.createdAt });
    byConcept.set(row.conceptId, rows);
  }

  return concepts.map((concept) => {
    const rows = byConcept.get(concept.id) ?? [];
    const assessment = classifyGrowth(rows);

    return {
      conceptId: concept.id,
      name: concept.name,
      mastery: assessment.mastery,
      band: assessment.band,
      delta: assessment.delta,
      evidenceCount: rows.length,
      series: masterySeries(rows),
    };
  });
}
