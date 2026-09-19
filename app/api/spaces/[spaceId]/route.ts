import { noContent, ok, parseJson, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { spaceUpdateSchema } from "@/lib/validation/spaces";
import { deleteSpace, getSpace, updateSpace } from "@/lib/services/spaces";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ spaceId: string }> };

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { spaceId } = await context.params;
    return ok({ space: await getSpace(user.id, spaceId) });
  });
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { spaceId } = await context.params;
    const input = await parseJson(request, spaceUpdateSchema);
    return ok({ space: await updateSpace(user.id, spaceId, input) });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { spaceId } = await context.params;
    await deleteSpace(user.id, spaceId);
    return noContent();
  });
}
