import { z } from "zod";

/**
 * A Tutor request. The question length is capped so a single call cannot be used to
 * push unbounded text through the prompt (and the bill).
 */
export const tutorRequestSchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  conversationId: z.string().min(1).optional(),
  message: z
    .string()
    .trim()
    .min(1, "Ask a question.")
    .max(4000, "That question is too long. Please shorten it."),
});

export type TutorRequestInput = z.infer<typeof tutorRequestSchema>;
