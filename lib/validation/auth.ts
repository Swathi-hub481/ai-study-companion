import { z } from "zod";

/**
 * Auth input schemas.
 *
 * Email is trimmed and lower-cased so that `Alice@Example.com` and
 * `alice@example.com` cannot become two accounts for one person.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password must be at most 200 characters.");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100, "Name is too long."),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Only presence is checked on login. Applying the length rules here would tell
  // an attacker that a rejected password could not have been valid anyway.
  password: z.string().min(1, "Password is required."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
