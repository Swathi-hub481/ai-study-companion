import { noContent, ok, parseJson, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { projectUpdateSchema } from "@/lib/validation/projects";
import { deleteProject, getProjectDashboard, updateProject } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

/** Returns the full dashboard summary, which is what every caller actually needs. */
export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;
    return ok(await getProjectDashboard(user.id, projectId));
  });
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;
    const input = await parseJson(request, projectUpdateSchema);
    return ok({ project: await updateProject(user.id, projectId, input) });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = await context.params;
    await deleteProject(user.id, projectId);
    return noContent();
  });
}
