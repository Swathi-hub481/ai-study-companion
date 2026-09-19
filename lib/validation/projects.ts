import { z } from "zod";

/**
 * A Project is the core learning workspace. It requires a name, a description, and
 * a learning goal — the goal is what the Tutor, the quiz selector, and the
 * recommendation engine all reason against, so it is mandatory rather than optional.
 */

const name = z.string().trim().min(1, "Name is required.").max(120, "Name is too long.");
const description = z
  .string()
  .trim()
  .min(1, "Description is required.")
  .max(1000, "Description must be at most 1000 characters.");
const goal = z
  .string()
  .trim()
  .min(1, "A learning goal is required.")
  .max(500, "Goal must be at most 500 characters.");

export const projectCreateSchema = z.object({
  spaceId: z.string().min(1, "A space is required."),
  name,
  description,
  goal,
});

export const projectUpdateSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    goal: goal.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

/** Query params for listing projects. */
export const projectListQuerySchema = z.object({
  spaceId: z.string().min(1, "spaceId is required."),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
