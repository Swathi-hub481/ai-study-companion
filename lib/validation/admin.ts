import { JobStatus } from "@prisma/client";
import { z } from "zod";

/** Request shapes for the admin views. */

export const adminUserListQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

export const adminActivityQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  spaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  // Free-form by design: an unknown type matches nothing rather than being rejected.
  type: z.string().trim().min(1).max(60).optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const adminAiQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional(),
});

export const adminJobsQuerySchema = z.object({
  status: z.nativeEnum(JobStatus).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export type AdminActivityQuery = z.infer<typeof adminActivityQuerySchema>;
