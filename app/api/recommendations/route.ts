import { z } from "zod";
import { ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { listRecommendations } from "@/lib/services/recommendations";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
});

/** Current recommendations for a Project, open ones first. */
export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = parseQuery(request, querySchema);

    return ok({ recommendations: await listRecommendations(user.id, projectId) });
  });
}
