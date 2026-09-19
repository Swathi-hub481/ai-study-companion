import { ok, route } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Returns the signed-in user, or `{ user: null }`. Used by the client shell. */
export async function GET() {
  return route(async () => {
    const user = await getCurrentUser();
    return ok({ user });
  });
}
