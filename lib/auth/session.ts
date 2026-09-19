import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env, isProduction } from "@/lib/config";
import { UnauthenticatedError } from "@/lib/errors";
import { generateSessionToken, hashToken } from "@/lib/auth/tokens";

/**
 * Server-side sessions.
 *
 * The browser holds only an opaque token in an httpOnly cookie. The authoritative
 * session lives in the database, which makes sessions revocable — a stateless JWT
 * could not be invalidated on logout or password change.
 */

export const SESSION_COOKIE_NAME = "asc_session";

/** A user with the password hash removed, safe to serialise to a client. */
export type SafeUser = Omit<User, "passwordHash">;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export type SessionMetadata = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Creates a session and returns the raw token. The caller is responsible for
 * putting the token in a cookie — this function never touches the request.
 */
export async function createSession(
  userId: string,
  metadata: SessionMetadata = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = expiryFrom(now);

  await prisma.$transaction([
    // Opportunistic cleanup so expired rows cannot accumulate indefinitely.
    prisma.session.deleteMany({ where: { userId, expiresAt: { lt: now } } }),
    prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt,
        userAgent: metadata.userAgent ?? null,
        ipAddress: metadata.ipAddress ?? null,
      },
    }),
  ]);

  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 0,
  });
}

/** Resolves the current user, or null. Never throws. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {
      // Another request may have removed it concurrently; that is fine.
    });
    return null;
  }

  return toSafeUser(session.user);
}

/** Resolves the current user, or throws 401. */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new UnauthenticatedError();
  }

  return user;
}

/** Revokes the session referenced by the current cookie, if any. */
export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  await clearSessionCookie();
}

/** Revokes every session for a user — used on password change or admin action. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
