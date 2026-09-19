import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { getSystemHealth } from "@/lib/services/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * System health for administrators — the queue, the database, and the configuration the
 * running process actually resolved.
 *
 * Deliberately richer than the public `/api/health`, which reports only up/down and
 * non-secret config. No secret is ever echoed here.
 */
export async function GET() {
  return route(async () => {
    const user = await requireUser();

    return ok({ health: await getSystemHealth(user) });
  });
}
