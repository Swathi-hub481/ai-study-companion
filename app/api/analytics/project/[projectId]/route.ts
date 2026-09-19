import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { getProjectAnalytics } from "@/lib/services/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

/** Analytics for one Project. Owner-scoped: a non-owner gets the usual 404. */
export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;

    return ok({ analytics: await getProjectAnalytics(user.id, projectId) });
  });
}
