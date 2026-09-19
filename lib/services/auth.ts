import { prisma } from "@/lib/db";
import { ConflictError, UnauthenticatedError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { toSafeUser, type SafeUser } from "@/lib/auth/session";
import type { LoginInput, RegisterInput } from "@/lib/validation/auth";

/**
 * Authentication business logic.
 *
 * Receives already-validated input and never touches cookies or the request, so it
 * stays testable and reusable.
 */

/**
 * A bcrypt hash to compare against when no user matches, so that a missing account
 * and a wrong password take comparable time. Computed once per process rather than
 * hard-coded, and never a valid credential for any account.
 */
let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("not-a-real-password-timing-equaliser");
  return dummyHash;
}

export async function registerUser(input: RegisterInput): Promise<SafeUser> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError("An account with that email already exists.");
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
  });

  return toSafeUser(user);
}

export async function authenticateUser(input: LoginInput): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDummyHash()),
  );

  // One message and one status for both failure modes, so the response cannot be
  // used to discover which email addresses have accounts.
  if (!user || !passwordMatches) {
    throw new UnauthenticatedError("Incorrect email or password.");
  }

  return toSafeUser(user);
}
