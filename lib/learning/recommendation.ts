/**
 * Recommendation vocabulary, shared by the dashboard, the Growth view, and the panel
 * that lists suggestions. Client-safe: no Prisma, no server imports.
 */

export type RecommendationStatusValue = "OPEN" | "DONE" | "DISMISSED";

/** The minimum a next-action needs. Kept separate so `fromRecommendation` can accept a
 *  row without depending on the wider view type. */
export type RecommendationLike = {
  title: string;
  body: string;
  reason: string | null;
  priority: number;
};

export type RecommendationView = RecommendationLike & {
  id: string;
  status: RecommendationStatusValue;
  conceptId: string | null;
  conceptName: string | null;
  createdAt: string;
};
