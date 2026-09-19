import { z } from "zod";

/** A Space is deliberately unconstrained in kind — any broad area of learning. */

const name = z.string().trim().min(1, "Name is required.").max(80, "Name is too long.");
const description = z
  .string()
  .trim()
  .min(1, "Description is required.")
  .max(500, "Description must be at most 500 characters.");

export const spaceCreateSchema = z.object({
  name,
  description,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #6366f1.")
    .optional(),
  icon: z.string().trim().max(40).optional(),
});

export const spaceUpdateSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #6366f1.")
      .optional(),
    icon: z.string().trim().max(40).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type SpaceCreateInput = z.infer<typeof spaceCreateSchema>;
export type SpaceUpdateInput = z.infer<typeof spaceUpdateSchema>;
