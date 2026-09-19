import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcryptjs is used rather than a native binding so the project installs and runs
 * identically on Windows, Linux, and in CI without a compiler toolchain.
 */

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
