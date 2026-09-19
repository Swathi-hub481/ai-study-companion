import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiFeature, type Material, type Project, type Space, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { createMaterial, processMaterial } from "@/lib/services/materials";
import { INSUFFICIENT_EVIDENCE_MESSAGE } from "@/lib/learning/tutor";
import { askTutor, listConversations, type TutorEvent } from "@/lib/services/tutor";
import { waitForDatabase } from "../helpers/db";

/**
 * The Phase 6 acceptance criterion, on real infrastructure:
 * answers cite real pages, and out-of-scope questions are explicitly refused.
 *
 * Runs against the deterministic mock provider (AI_PROVIDER=mock). Its embeddings are
 * stable per input text — identical text yields cosine similarity 1.0, unrelated text
 * is effectively orthogonal — which is what makes retrieval here deterministic.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PLACEHOLDER_HASH = "test-placeholder-not-a-real-hash";

async function collectTutorEvents(
  userId: string,
  input: { projectId: string; conversationId?: string; message: string },
): Promise<TutorEvent[]> {
  const events: TutorEvent[] = [];
  for await (const event of askTutor(userId, input)) events.push(event);
  return events;
}

function lastEvent(events: TutorEvent[]): TutorEvent | undefined {
  return events[events.length - 1];
}

describe("tutor", () => {
  let user: User;
  let space: Space;
  let project: Project;
  let material: Material;
  let storageKey: string;
  let jobKey: string;

  /** A question identical to a stored chunk, so the mock returns a near-perfect match. */
  let groundedQuery: string;

  beforeAll(async () => {
    await waitForDatabase();

    user = await prisma.user.create({
      data: { email: `tutor-${runId}@example.com`, name: "Tutor Tester", passwordHash: PLACEHOLDER_HASH },
    });

    space = await prisma.space.create({
      data: { userId: user.id, name: `Tutor space ${runId}`, description: "Tutor tests." },
    });

    project = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Tutor project ${runId}`,
        description: "Tutor tests.",
        goal: "Prove grounded answers and refusal.",
      },
    });

    material = await createMaterial(user.id, project.id, {
      filename: "Gradient Descent Notes.pdf",
      declaredMimeType: "application/pdf",
      data: await readFile(path.join(fixtures, "text-document.pdf")),
    });

    storageKey = material.storageKey;
    jobKey = `material:${material.id}:process`;

    // Process directly rather than draining the global queue, so this file cannot
    // claim (or be claimed by) another test file's jobs.
    await processMaterial(material.id);
    await prisma.job.deleteMany({ where: { idempotencyKey: jobKey } });

    const chunks = await prisma.chunk.findMany({
      where: { materialId: material.id },
      orderBy: { ord: "asc" },
    });

    // Retrieval trims the query; pick a chunk whose stored text is already trimmed so
    // the two embeddings are computed from an identical string.
    const target = chunks.find((chunk) => chunk.content === chunk.content.trim()) ?? chunks[0];
    if (!target) throw new Error("Expected the fixture to produce chunks.");
    groundedQuery = target.content;
  });

  afterAll(async () => {
    await getStorage().delete(storageKey).catch(() => {});
    await prisma.job.deleteMany({ where: { idempotencyKey: jobKey } });
    if (user?.id) await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("streams a grounded answer with citations and persists the turn", async () => {
    const events = await collectTutorEvents(user.id, {
      projectId: project.id,
      message: groundedQuery,
    });

    const citationsEvent = events.find((event) => event.type === "citations");
    expect(citationsEvent?.type).toBe("citations");

    const citations = citationsEvent?.type === "citations" ? citationsEvent.citations : [];
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0]?.materialId).toBe(material.id);
    expect(citations[0]?.title).toBe("Gradient Descent Notes.pdf");

    const answer = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("");
    expect(answer.length).toBeGreaterThan(0);

    const done = lastEvent(events);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") throw new Error("expected a done event");

    const messages = await prisma.message.findMany({
      where: { conversationId: done.conversationId },
      orderBy: { createdAt: "asc" },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("USER");
    expect(messages[1]?.role).toBe("ASSISTANT");
    expect(messages[1]?.content).toBe(answer);
    expect((messages[1]?.citations as unknown[] | null)?.length).toBe(citations.length);

    // One AI call for the answer, plus the query embedding.
    expect(
      await prisma.aiRequest.count({ where: { projectId: project.id, feature: AiFeature.TUTOR } }),
    ).toBe(1);
    expect(
      await prisma.activityEvent.count({ where: { projectId: project.id, type: "TUTOR_MESSAGE" } }),
    ).toBe(1);
  });

  it("refuses explicitly when the materials hold no supporting evidence", async () => {
    const tutorCallsBefore = await prisma.aiRequest.count({
      where: { projectId: project.id, feature: AiFeature.TUTOR },
    });

    const events = await collectTutorEvents(user.id, {
      projectId: project.id,
      message: "Explain the mating rituals of Antarctic krill using quantum field theory.",
    });

    expect(events[0]?.type).toBe("insufficient_evidence");
    expect(lastEvent(events)?.type).toBe("done");
    // No citations, and no answer generated.
    expect(events.some((event) => event.type === "citations")).toBe(false);
    expect(events.some((event) => event.type === "delta")).toBe(false);

    const refusal = await prisma.message.findFirst({
      where: { conversation: { projectId: project.id } },
      orderBy: { createdAt: "desc" },
    });

    expect(refusal?.role).toBe("ASSISTANT");
    expect(refusal?.content).toBe(INSUFFICIENT_EVIDENCE_MESSAGE);
    expect(refusal?.citations).toEqual([]);

    expect(
      await prisma.activityEvent.count({
        where: { projectId: project.id, type: "UNSUPPORTED_QUESTION" },
      }),
    ).toBe(1);

    // The gate is before the model call, so no Tutor request was made.
    expect(
      await prisma.aiRequest.count({ where: { projectId: project.id, feature: AiFeature.TUTOR } }),
    ).toBe(tutorCallsBefore);
  });

  it("refuses a caller who does not own the Project", async () => {
    const other = await prisma.user.create({
      data: { email: `tutor-other-${runId}@example.com`, name: "Other", passwordHash: PLACEHOLDER_HASH },
    });

    try {
      await expect(
        collectTutorEvents(other.id, { projectId: project.id, message: groundedQuery }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("never answers a Project from another Project's evidence", async () => {
    const empty = await prisma.project.create({
      data: {
        spaceId: space.id,
        name: `Empty project ${runId}`,
        description: "No materials.",
        goal: "Nothing to retrieve.",
      },
    });

    try {
      // The same question the first Project answers confidently.
      const events = await collectTutorEvents(user.id, {
        projectId: empty.id,
        message: groundedQuery,
      });

      expect(events[0]?.type).toBe("insufficient_evidence");
      expect(
        await prisma.message.count({ where: { conversation: { projectId: empty.id } } }),
      ).toBe(2);
    } finally {
      await prisma.project.deleteMany({ where: { id: empty.id } });
    }
  });

  it("continues an existing conversation instead of starting a new one", async () => {
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { projectId: project.id },
      orderBy: { updatedAt: "desc" },
    });

    const before = await prisma.message.count({ where: { conversationId: conversation.id } });

    const events = await collectTutorEvents(user.id, {
      projectId: project.id,
      conversationId: conversation.id,
      message: groundedQuery,
    });

    const done = lastEvent(events);
    if (done?.type !== "done") throw new Error("expected a done event");
    expect(done.conversationId).toBe(conversation.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(
      before + 2,
    );
  });

  it("lists conversations newest first, with their messages in order", async () => {
    const conversations = await listConversations(user.id, project.id);

    expect(conversations.length).toBeGreaterThanOrEqual(2);
    expect(conversations[0]!.messages.length).toBeGreaterThan(0);

    const [first, second] = conversations;
    expect(first!.updatedAt.getTime()).toBeGreaterThanOrEqual(second!.updatedAt.getTime());
  });
});
