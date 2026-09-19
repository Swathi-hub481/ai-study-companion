import { ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { listActivity } from "@/lib/services/admin";
import { adminActivityQuerySchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";

/** The activity feed, filterable by user, space, project, type, and time range. */
export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { days, ...filters } = parseQuery(request, adminActivityQuerySchema);

    return ok(
      await listActivity(user, {
        ...filters,
        since: days ? new Date(Date.now() - days * 86_400_000) : undefined,
      }),
    );
  });
}
