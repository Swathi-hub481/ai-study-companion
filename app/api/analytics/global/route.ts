import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { getGlobalAnalytics } from "@/lib/services/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Instance-wide analytics.
 *
 * Admin-only by construction: the service calls `requireAdmin`, so a non-admin gets a
 * 403 from the single place that decides — not from a check this route could forget.
 */
export async function GET() {
  return route(async () => {
    const user = await requireUser();

    return ok({ analytics: await getGlobalAnalytics(user) });
  });
}
