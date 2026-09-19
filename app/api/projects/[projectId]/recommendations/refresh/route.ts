import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { requestRecommendations } from "@/lib/services/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

/**
 * Ask for fresh recommendations.
 *
 * Returns 202: the work is a model call, so it happens in the worker rather than in the
 * request. The client re-reads the list rather than waiting on this response.
 */
export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;

    // The idempotency key already collapses repeat clicks within a minute; this bounds
    // what a caller can queue across different minutes.
    enforcePolicy(`recommendations:${user.id}`, RATE_LIMITS.recommendationsRefresh);

    await requestRecommendations(user.id, projectId);

    return ok({ queued: true }, { status: 202 });
  });
}
