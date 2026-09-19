import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session token helpers.
 *
 * Only the SHA-256 hash of a token is ever persisted. A leaked database snapshot
 * therefore yields no usable sessions, and a stolen token cannot be recovered from
 * the row. Lookups still work because the hash is deterministic and uniquely indexed.
 *
 * Kept free of database and framework imports so it is directly unit-testable.
 */

const TOKEN_BYTES = 32;

/** Generates a cryptographically random, URL-safe session token. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Deterministic hash used as the session lookup key. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, for cases where two secrets are compared directly. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}
