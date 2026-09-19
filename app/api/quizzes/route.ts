import { created, ok, parseJson, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { quizCreateSchema, quizListQuerySchema } from "@/lib/validation/quizzes";
import { listQuizzes, startQuiz } from "@/lib/services/quizzes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Recent quizzes for a Project. */
export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = parseQuery(request, quizListQuerySchema);

    return ok({ quizzes: await listQuizzes(user.id, projectId) });
  });
}

/** Start an adaptive quiz: selects concepts, generates grounded questions. */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser();

    // Generating a quiz is two model calls per question, so it is limited before any
    // of that spend happens.
    enforcePolicy(`quiz-start:${user.id}`, RATE_LIMITS.quizStart);

    const input = await parseJson(request, quizCreateSchema);

    return created({ quiz: await startQuiz(user.id, input) });
  });
}
