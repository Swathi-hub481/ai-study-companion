import { ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { completeQuiz } from "@/lib/services/quizzes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ quizId: string }> };

/** Finalize a quiz and enqueue its evaluation. Idempotent. */
export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { quizId } = await context.params;

    // Completing queues two model-backed jobs.
    enforcePolicy(`quiz-complete:${user.id}`, RATE_LIMITS.quizComplete);

    return ok({ quiz: await completeQuiz(user.id, quizId) });
  });
}
