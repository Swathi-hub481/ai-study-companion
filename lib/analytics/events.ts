import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActivityType } from "@/lib/analytics/activity-types";

/**
 * The learning event log.
 *
 * Events are written in the *same transaction* as the state change they describe.
 * That is what lets analytics and the activity feed be trusted: they cannot drift
 * from the data, and a rolled-back write leaves no orphan event behind.
 *
 * The vocabulary lives in `activity-types.ts` so client components can import the
 * labels without pulling this module (and Prisma) into the browser bundle.
 */

export { ActivityType, ACTIVITY_LABELS, activityLabel } from "@/lib/analytics/activity-types";
export type { ActivityType as ActivityTypeName } from "@/lib/analytics/activity-types";

/**
 * Accepts either the root client or a transaction client, so callers can always
 * enlist an event in the transaction that performed the change.
 */
export type ActivityDb = Pick<PrismaClient, "activityEvent">;

export async function recordActivity(
  db: ActivityDb,
  input: {
    userId: string;
    type: ActivityType;
    spaceId?: string | null;
    projectId?: string | null;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.activityEvent.create({
    data: {
      userId: input.userId,
      type: input.type,
      spaceId: input.spaceId ?? null,
      projectId: input.projectId ?? null,
      payload: input.payload,
    },
  });
}
