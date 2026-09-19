import { noContent, route } from "@/lib/http";
import { revokeCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Revokes the session server-side and clears the cookie. The row is deleted rather
 * than merely forgotten client-side, so a copied token stops working immediately.
 */
export async function POST() {
  return route(async () => {
    await revokeCurrentSession();
    return noContent();
  });
}
