import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/services/tutor";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

/** Conversation history for a Project, newest first, with messages in order. */
export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;

    return ok({ conversations: await listConversations(user.id, projectId) });
  });
}
