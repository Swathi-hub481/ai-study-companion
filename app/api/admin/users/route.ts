import { ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { listUsers } from "@/lib/services/admin";
import { adminUserListQuerySchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const query = parseQuery(request, adminUserListQuerySchema);

    return ok(await listUsers(user, query));
  });
}
