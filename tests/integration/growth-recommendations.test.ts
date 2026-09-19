import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Concept, type Project, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProjectGrowth } from "@/lib/services/growth";
import {
  generateForProject,
  listForProject,
  listRecommendations,
} from "@/lib/services/recommendations";
import { getContextSlice, rebuildLearningContext } from "@/lib/services/learning-context";
import { refreshProjectMastery } from "@/lib/services/mastery";
import { getProjectDashboard } from "@/lib/services/projects";
import { GROWTH_BAND_ORDER } from "@/lib/learning/growth";
import { waitForDatabase } from "../helpers/db";

/**
 * Phase 8's acceptance criterion: the derived state (bands, recommendations, curated
 * context) follows from real evidence, and the dashboard states a defensible next action.
 */

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

describe("growth, recommendations and context", () => {
  let user: User;
  let space: Space;
  let project: Project;
  let improving: Concept;
  let declining: Concept;
  let flatLow: Concept;
  let otherUser: User;

  beforeAll(async () => {
    await waitForDatabase();

    user = await prisma.user.create({
      data: { email: `growth-${runId}@example.com`, name: "Growth Tester", passwordHash: PLACEHOLDER_HASH },
    });

    space = await prisma.space.create({
      data: { userId: user.id, name: `Growth space ${runId}`, description: "Growth tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Growth project ${runId}`,
        description: "Growth tests.",
        goal: "Prove growth classification and recommendations.",
      },
    });

    const makeConcept = (name: string) =>
      prisma.concept.create({
        data: { projectId: project.id, name, description: `${name} description`, importance: 0.8 },
      });

    improving = await makeConcept("Improving concept");
    declining = await makeConcept("Declining concept");
    flatLow = await makeConcept("Flat low concept");

    // Evidence shaped so each band is unambiguous.
    await prisma.conceptEvidence.createMany({
      data: [
        // Started weak, now strong → improving.
        { projectId: project.id, conceptId: improving.id, source: "QUIZ_ANSWER", score: 0.1, weight: 1, createdAt: daysAgo(30) },
        { projectId: project.id, conceptId: improving.id, source: "QUIZ_ANSWER", score: 1, weight: 1, createdAt: daysAgo(2) },

        // Started strong, then two recent failures → declining, with repeated mistakes.
        { projectId: project.id, conceptId: declining.id, source: "QUIZ_ANSWER", score: 1, weight: 1, createdAt: daysAgo(30) },
        { projectId: project.id, conceptId: declining.id, source: "QUIZ_ANSWER", score: 0, weight: 1, createdAt: daysAgo(2) },
        { projectId: project.id, conceptId: declining.id, source: "QUIZ_ANSWER", score: 0, weight: 1, createdAt: daysAgo(1) },

        // Never moving, and low → needs attention anyway.
        { projectId: project.id, conceptId: flatLow.id, source: "QUIZ_ANSWER", score: 0.2, weight: 1, createdAt: daysAgo(10) },
        { projectId: project.id, conceptId: flatLow.id, source: "QUIZ_ANSWER", score: 0.2, weight: 1, createdAt: daysAgo(5) },
      ],
    });

    otherUser = await prisma.user.create({
      data: { email: `growth-other-${runId}@example.com`, name: "Other", passwordHash: PLACEHOLDER_HASH },
    });
  });

  afterAll(async () => {
    for (const id of [user?.id, otherUser?.id]) {
      if (id) await prisma.user.deleteMany({ where: { id } });
    }
  });

  it("classifies each concept's band from its own evidence", async () => {
    const growth = await getProjectGrowth(user.id, project.id);
    const byConcept = new Map(growth.map((entry) => [entry.conceptId, entry]));

    expect(byConcept.get(improving.id)?.band).toBe("IMPROVING");
    expect(byConcept.get(declining.id)?.band).toBe("NEEDS_ATTENTION");
    expect(byConcept.get(flatLow.id)?.band).toBe("NEEDS_ATTENTION");

    expect(byConcept.get(improving.id)?.delta).toBeGreaterThan(0);
    expect(byConcept.get(declining.id)?.delta).toBeLessThan(0);
    expect(byConcept.get(flatLow.id)?.delta).toBe(0);

    expect(byConcept.get(improving.id)?.evidenceCount).toBe(2);
    expect(byConcept.get(improving.id)?.series).toHaveLength(2);
  });

  it("partitions every concept into exactly one band for the Growth view", async () => {
    const growth = await getProjectGrowth(user.id, project.id);

    // The page groups with GROWTH_BAND_ORDER; a band missing from that list would drop
    // concepts from the view entirely.
    const grouped = GROWTH_BAND_ORDER.flatMap((band) =>
      growth.filter((concept) => concept.band === band),
    );

    expect(grouped).toHaveLength(growth.length);
    expect(new Set(grouped.map((concept) => concept.conceptId)).size).toBe(growth.length);
  });

  it("generates recommendations grounded in the current state, and records it", async () => {
    const result = await generateForProject(project.id);

    expect(result.concepts).toBe(3);
    expect(result.created).toBeGreaterThan(0);

    const open = (await listForProject(project.id)).filter((entry) => entry.status === "OPEN");

    expect(open.length).toBeGreaterThan(0);
    // A recommendation without a reason is not actionable, so the schema requires one.
    expect(open[0]?.reason).toBeTruthy();
    expect(open[0]?.priority).toBeGreaterThan(0);

    expect(
      await prisma.activityEvent.count({
        where: { projectId: project.id, type: "RECOMMENDATION_CREATED" },
      }),
    ).toBe(1);
  });

  it("replaces the open set on regeneration instead of accumulating duplicates", async () => {
    const first = await listForProject(project.id);

    await generateForProject(project.id);

    const second = await listForProject(project.id);

    expect(second).toHaveLength(first.length);
    expect(second.map((entry) => entry.id).sort()).not.toEqual(first.map((entry) => entry.id).sort());
  });

  it("rebuilds the curated context from evidence, never from a transcript", async () => {
    const rebuilt = await rebuildLearningContext(project.id);

    expect(rebuilt.strengths).toBeGreaterThan(0);
    expect(rebuilt.weaknesses).toBeGreaterThan(0);
    expect(rebuilt.repeatedMistakes).toBeGreaterThan(0);

    const slice = await getContextSlice(project.id);

    expect(slice.goal).toBe(project.goal);
    expect(slice.strengths).toContain(improving.name);
    expect(slice.weaknesses).toContain(declining.name);
    expect(slice.repeatedMistakes).toContain(declining.name);

    // No conversation exists, so no summary was invented.
    expect(slice.tutorSummary).toBeNull();
  });

  it("recomputes stale mastery from evidence rather than trusting the stored value", async () => {
    await prisma.concept.update({ where: { id: improving.id }, data: { mastery: 0 } });

    const refreshed = await refreshProjectMastery(project.id);

    expect(refreshed.concepts).toBe(3);

    const concept = await prisma.concept.findUniqueOrThrow({ where: { id: improving.id } });
    expect(concept.mastery).toBeGreaterThan(0.7);
  });

  it("states a generated next action, and falls back to the heuristic without one", async () => {
    const withRecommendations = await getProjectDashboard(user.id, project.id);

    expect(withRecommendations.nextAction.source).toBe("recommendation");
    expect(withRecommendations.nextAction.basis.length).toBeGreaterThan(0);
    expect(withRecommendations.recommendations.some((entry) => entry.status === "OPEN")).toBe(true);

    await prisma.recommendation.deleteMany({ where: { projectId: project.id } });

    const withoutRecommendations = await getProjectDashboard(user.id, project.id);

    expect(withoutRecommendations.nextAction.source).toBe("heuristic");
    expect(withoutRecommendations.nextAction.basis).toBe("Based on your materials");
  });

  it("keeps recommendations private to their owner", async () => {
    await expect(getProjectGrowth(otherUser.id, project.id)).rejects.toThrow();
    await expect(listRecommendations(otherUser.id, project.id)).rejects.toThrow();
  });
});
