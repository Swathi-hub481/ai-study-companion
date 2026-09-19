import { ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { listJobs } from "@/lib/services/admin";
import { countJobsByStatus } from "@/lib/jobs/queue";
import { adminJobsQuerySchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Background processing: counts by status, and the rows behind them. */
export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const options = parseQuery(request, adminJobsQuerySchema);

    const [jobs, counts] = await Promise.all([listJobs(user, options), countJobsByStatus()]);

    return ok({ jobs, counts });
  });
}
