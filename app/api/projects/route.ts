import { created, ok, parseJson, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { projectCreateSchema, projectListQuerySchema } from "@/lib/validation/projects";
import { createProject, listProjectsForSpace } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { spaceId } = parseQuery(request, projectListQuerySchema);
    return ok({ projects: await listProjectsForSpace(user.id, spaceId) });
  });
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const input = await parseJson(request, projectCreateSchema);
    return created({ project: await createProject(user.id, input) });
  });
}
