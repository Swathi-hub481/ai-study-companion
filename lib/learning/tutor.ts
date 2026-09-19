/**
 * Tutor domain vocabulary.
 *
 * Deliberately free of Prisma and server imports, so presentational components can
 * share these values without pulling the database or the AI layer into the browser
 * bundle — the boundary eslint.config.mjs enforces for `components/**`.
 */

/** A source backing an answer. Real documents and pages, taken from retrieval. */
export type Citation = {
  materialId: string;
  title: string;
  page: number | null;
  score: number;
};

/**
 * Shown instead of an answer when the evidence gate finds nothing usable. The Tutor
 * refuses rather than answering from general knowledge.
 */
export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "This Project's materials do not contain enough evidence to answer that. " +
  "Try uploading a source that covers it, or rephrase the question.";
