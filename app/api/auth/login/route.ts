import { clientIp, clientMetadata, ok, parseJson, route } from "@/lib/http";
import { loginSchema } from "@/lib/validation/auth";
import { authenticateUser } from "@/lib/services/auth";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return route(async () => {
    const ip = clientIp(request);

    // Coarse per-address limit first, so a flood of malformed bodies is cheap to reject.
    enforcePolicy(`login:ip:${ip}`, RATE_LIMITS.loginPerIp);

    const input = await parseJson(request, loginSchema);

    // Then a tighter per-account limit, which is what actually resists credential
    // stuffing against a single account from one address.
    enforcePolicy(`login:${ip}:${input.email}`, RATE_LIMITS.loginPerAccount);

    const user = await authenticateUser(input);

    const { token, expiresAt } = await createSession(user.id, clientMetadata(request));
    await setSessionCookie(token, expiresAt);

    return ok({ user });
  });
}
