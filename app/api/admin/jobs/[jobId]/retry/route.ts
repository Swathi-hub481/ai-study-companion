import { noContent, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { retryJob } from "@/lib/services/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string }> };

/**
 * Puts a failed or dead-lettered job back on the queue.
 *
 * The dead-letter queue is only useful if something can drain it, and §9 requires failed
 * work to be *visible* rather than merely retained.
 */
export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { jobId } = await context.params;

    await retryJob(user, jobId);

    return noContent();
  });
}
