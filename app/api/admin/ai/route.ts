import { ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { getAiUsage, getLatestEvaluation } from "@/lib/services/admin";
import { adminAiQuerySchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** AI usage plus the most recent evaluation run. */
export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { days } = parseQuery(request, adminAiQuerySchema);

    const [usage, evaluation] = await Promise.all([
      getAiUsage(user, { days }),
      getLatestEvaluation(user),
    ]);

    return ok({ usage, evaluation });
  });
}
