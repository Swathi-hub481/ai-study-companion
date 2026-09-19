import { created, clientIp, clientMetadata, parseJson, route } from "@/lib/http";
import { registerSchema } from "@/lib/validation/auth";
import { registerUser } from "@/lib/services/auth";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return route(async () => {
    enforcePolicy(`register:ip:${clientIp(request)}`, RATE_LIMITS.registerPerIp);

    const input = await parseJson(request, registerSchema);
    const user = await registerUser(input);

    const { token, expiresAt } = await createSession(user.id, clientMetadata(request));
    await setSessionCookie(token, expiresAt);

    return created({ user });
  });
}
