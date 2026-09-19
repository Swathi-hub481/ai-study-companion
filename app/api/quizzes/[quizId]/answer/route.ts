import { ok, parseJson, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { quizAnswerSchema } from "@/lib/validation/quizzes";
import { submitAnswer } from "@/lib/services/quizzes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ quizId: string }> };

/**
 * Submit and grade one answer.
 *
 * Multiple choice is graded by comparison and never reaches a model; open-ended answers
 * are graded against the project's own material. Either way the response carries the
 * feedback, so the learner sees why immediately.
 */
export async function POST(request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { quizId } = await context.params;

    // Grading is a model call for open-ended answers; the limit applies before it.
    enforcePolicy(`quiz-answer:${user.id}`, RATE_LIMITS.quizAnswer);

    const input = await parseJson(request, quizAnswerSchema);

    const { result, mastery } = await submitAnswer(user.id, quizId, input);

    return ok({ result, mastery });
  });
}
