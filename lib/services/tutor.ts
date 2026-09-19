import { MessageRole, Prisma, type Project } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db";
import { assertProjectAccess } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import { INSUFFICIENT_EVIDENCE_MESSAGE, type Citation } from "@/lib/learning/tutor";
import { retrieveEvidence } from "@/lib/rag/retrieve";
import { buildCitations } from "@/lib/rag/cite";
import { streamTutorAnswer, type TutorHistoryTurn } from "@/lib/ai/features/tutor-answer";
import { getContextSlice } from "@/lib/services/learning-context";
import { timed, type TimingSession } from "@/lib/performance/timing";

/**
 * The Tutor, orchestrated.
 *
 * The whole turn is expressed as one async generator of typed events. That keeps the
 * route a dumb serializer (it owns SSE framing and nothing else) and makes the
 * behaviour testable without HTTP: a test can consume `askTutor` directly and assert
 * on the events and the rows they left behind.
 *
 * Ordering mirrors architecture.md §7.2: persist the question, retrieve, gate on
 * evidence, stream, then persist the answer with its citations.
 */

export type TutorEvent =
  | { type: "citations"; conversationId: string; citations: Citation[] }
  | { type: "delta"; text: string }
  | {
      type: "insufficient_evidence";
      conversationId: string;
      messageId: string;
      message: string;
    }
  | { type: "done"; conversationId: string; messageId: string };

const CONVERSATION_TITLE_LENGTH = 60;

/** A conversation is titled by the question that started it. */
function deriveTitle(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, " ");

  return cleaned.length <= CONVERSATION_TITLE_LENGTH
    ? cleaned
    : `${cleaned.slice(0, CONVERSATION_TITLE_LENGTH - 1)}…`;
}

export async function listConversations(userId: string, projectId: string) {
  const project = await assertProjectAccess(userId, projectId);

  return prisma.conversation.findMany({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function* askTutor(
  userId: string,
  input: { projectId: string; conversationId?: string; message: string },
  /**
   * Optional timing session. Present only when a caller explicitly wants a breakdown,
   * so the production path pays nothing for instrumentation it will not read.
   */
  options: {
    timing?: TimingSession;
    /**
     * A project the caller has *already* proven belongs to `userId`.
     *
     * The HTTP route resolves ownership before opening the stream, so a project the
     * caller does not own is a JSON 404 rather than a mid-stream error event. Without
     * this, every Tutor turn repeated the identical ownership query. Callers that have
     * not checked must omit it, and the check happens here as before.
     */
    project?: Project;
  } = {},
): AsyncGenerator<TutorEvent, void, undefined> {
  const timing = options.timing;

  const project =
    options.project ??
    (await timed(timing, "tutor.access", () => assertProjectAccess(userId, input.projectId)));

  const conversation = input.conversationId
    ? await timed(timing, "tutor.conversation", () =>
        prisma.conversation.findFirst({
          where: { id: input.conversationId, projectId: project.id },
        }),
      )
    : null;

  if (input.conversationId && !conversation) {
    // Same collapse as everywhere else: an id that is not yours is "not found".
    throw new NotFoundError("Conversation");
  }

  const thread =
    conversation ??
    (await timed(timing, "tutor.conversation", () =>
      prisma.conversation.create({
        data: { projectId: project.id, title: deriveTitle(input.message) },
      }),
    ));

  // The window is read *before* the new question is written, so the prompt contains
  // only prior turns; the current question is added explicitly below.
  const recent = await timed(timing, "tutor.history", () =>
    prisma.message.findMany({
      where: { conversationId: thread.id },
      orderBy: { createdAt: "desc" },
      take: env.CONVERSATION_WINDOW_TURNS,
      select: { role: true, content: true },
    }),
  );

  const history: TutorHistoryTurn[] = recent
    .reverse()
    .filter(
      (message) => message.role === MessageRole.USER || message.role === MessageRole.ASSISTANT,
    )
    .map((message) => ({
      role: message.role as TutorHistoryTurn["role"],
      content: message.content,
    }));

  /*
   * Three independent pieces of work, so they share one round trip:
   *
   *  - persisting the question, which the stream never waits on because the answer is
   *    written much later (after the model has finished);
   *  - retrieving evidence for it;
   *  - reading the curated context slice.
   *
   * The history window was read *before* this point, so the question being written
   * here cannot appear in the prompt's conversation window.
   */
  const [, evidence, learningContext] = await Promise.all([
    timed(timing, "tutor.persist_question", () =>
      prisma.$transaction(async (tx) => {
        await tx.message.create({
          data: { conversationId: thread.id, role: MessageRole.USER, content: input.message },
        });

        // Message writes do not touch the parent, so recency is updated explicitly.
        await tx.conversation.update({
          where: { id: thread.id },
          data: { updatedAt: new Date() },
        });
      }),
    ),
    retrieveEvidence({ userId, projectId: project.id, query: input.message, timing }),
    timed(timing, "tutor.context", () => getContextSlice(project.id)),
  ]);

  // Evidence gate: no fabricated answer when the Project cannot support one.
  if (evidence.length === 0) {
    const refusal = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: thread.id,
          role: MessageRole.ASSISTANT,
          content: INSUFFICIENT_EVIDENCE_MESSAGE,
          citations: [],
        },
      });

      await recordActivity(tx, {
        userId,
        type: ActivityType.UNSUPPORTED_QUESTION,
        spaceId: project.spaceId,
        projectId: project.id,
        payload: { question: input.message.slice(0, 200) },
      });

      return created;
    });

    yield {
      type: "insufficient_evidence",
      conversationId: thread.id,
      messageId: refusal.id,
      message: INSUFFICIENT_EVIDENCE_MESSAGE,
    };
    yield { type: "done", conversationId: thread.id, messageId: refusal.id };
    return;
  }

  const citations = buildCitations(evidence);
  yield { type: "citations", conversationId: thread.id, citations };

  let answer = "";

  // Marked rather than nested: "time to first token" is the metric that governs how
  // fast the Tutor *feels*, and it is measured from the start of the turn.
  timing?.mark("tutor.model_request");
  let sawFirstToken = false;

  for await (const chunk of streamTutorAnswer(
    { userId, projectId: project.id },
    {
      project: { name: project.name, description: project.description, goal: project.goal },
      evidence,
      history,
      summary: thread.summary,
      learningContext,
      question: input.message,
    },
  )) {
    if (!sawFirstToken) {
      sawFirstToken = true;
      timing?.mark("tutor.first_token");
    }

    answer += chunk.delta;
    yield { type: "delta", text: chunk.delta };
  }

  timing?.mark("tutor.stream_complete");

  /*
   * A mid-stream failure never reaches here — the error propagates out of the
   * generator, so no half-written answer is stored. The AiRequest row is still
   * recorded by `aiStreamText`'s `finally`.
   */
  const assistant = await timed(timing, "tutor.persist_answer", () =>
    prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: thread.id,
          role: MessageRole.ASSISTANT,
          content: answer,
          citations: citations as unknown as Prisma.InputJsonValue,
        },
      });

      await recordActivity(tx, {
        userId,
        type: ActivityType.TUTOR_MESSAGE,
        spaceId: project.spaceId,
        projectId: project.id,
        payload: { conversationId: thread.id, citationCount: citations.length },
      });

      return created;
    }),
  );

  yield { type: "done", conversationId: thread.id, messageId: assistant.id };
}
