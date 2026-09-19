import { created, ok, parseJson, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { spaceCreateSchema } from "@/lib/validation/spaces";
import { createSpace, listSpaces } from "@/lib/services/spaces";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => {
    const user = await requireUser();
    return ok({ spaces: await listSpaces(user.id) });
  });
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const input = await parseJson(request, spaceCreateSchema);
    return created({ space: await createSpace(user.id, input) });
  });
}
