import type { NextResponse } from "next/server";
import type { Project } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { parseJson, toErrorResponse } from "@/lib/http";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { assertProjectAccess } from "@/lib/auth/guards";
import { tutorRequestSchema, type TutorRequestInput } from "@/lib/validation/tutor";
import { askTutor } from "@/lib/services/tutor";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Grounded Tutor answers, streamed as Server-Sent Events.
 *
 * This route is the one deliberate exception to the `{ data }` JSON envelope (the
 * other being `health`): a streaming response has no single body to wrap. Anything
 * that fails *before* the stream opens — auth, rate limit, validation, project
 * ownership — still returns the normal error envelope with a correct status code.
 * Failures *after* it opens can only be reported as an `error` event.
 */

/**
 * A ceiling on how long a stream may stay open.
 *
 * A generation that stalls would otherwise hold the connection until the host's own limit
 * kills it, which reads as a hung page. The deadline is checked between events; because a
 * streaming answer emits frequently, that is an effective guard. `maxDuration` is the
 * host-level backstop where the platform honours it.
 */
const STREAM_DEADLINE_MS = 55_000;

export const maxDuration = 60;

type Authorized = { userId: string; input: TutorRequestInput; project: Project };
type PreflightResult = { ok: true; value: Authorized } | { ok: false; response: NextResponse };

async function preflight(request: Request): Promise<PreflightResult> {
  try {
    const user = await requireUser();

    enforcePolicy(`tutor:${user.id}`, RATE_LIMITS.tutor);

    const input = await parseJson(request, tutorRequestSchema);

    // Resolved here, before the stream opens, so a project the caller does not own is
    // a JSON 404 rather than a mid-stream error event. The resolved project is handed
    // to the service so the same ownership query is not issued twice per turn.
    const project = await assertProjectAccess(user.id, input.projectId);

    return { ok: true, value: { userId: user.id, input, project } };
  } catch (error) {
    return { ok: false, response: toErrorResponse(error) };
  }
}

export async function POST(request: Request) {
  const result = await preflight(request);

  if (!result.ok) return result.response;

  const { userId, input, project } = result.value;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const startedAt = Date.now();

      try {
        for await (const event of askTutor(userId, input, { project })) {
          if (Date.now() - startedAt > STREAM_DEADLINE_MS) {
            logger.warn(
              { projectId: input.projectId, elapsedMs: Date.now() - startedAt },
              "Tutor stream exceeded its deadline",
            );

            send("error", {
              code: "AI_ERROR",
              message: "That answer took too long to finish. Please try again.",
            });

            return;
          }

          send(event.type, event);
        }
      } catch (error) {
        logger.error({ err: error, projectId: input.projectId }, "Tutor stream failed");

        try {
          send("error", {
            code: "AI_ERROR",
            message: "The Tutor could not finish that answer. Please try again.",
          });
        } catch {
          // The consumer already disconnected; there is nothing left to report to.
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell reverse proxies not to buffer, which would defeat streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
