/**
 * Activity vocabulary.
 *
 * Deliberately free of any Prisma import so client components can use these labels
 * without dragging the database client into the browser bundle.
 */

export const ActivityType = {
  SPACE_CREATED: "SPACE_CREATED",
  SPACE_UPDATED: "SPACE_UPDATED",
  SPACE_DELETED: "SPACE_DELETED",

  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_UPDATED: "PROJECT_UPDATED",
  PROJECT_DELETED: "PROJECT_DELETED",

  MATERIAL_UPLOADED: "MATERIAL_UPLOADED",
  MATERIAL_READY: "MATERIAL_READY",
  MATERIAL_FAILED: "MATERIAL_FAILED",

  TUTOR_MESSAGE: "TUTOR_MESSAGE",
  UNSUPPORTED_QUESTION: "UNSUPPORTED_QUESTION",

  QUIZ_STARTED: "QUIZ_STARTED",
  QUIZ_COMPLETED: "QUIZ_COMPLETED",
  ANSWER_GRADED: "ANSWER_GRADED",

  MASTERY_UPDATED: "MASTERY_UPDATED",
  RECOMMENDATION_CREATED: "RECOMMENDATION_CREATED",
  JOB_FAILED: "JOB_FAILED",
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

/** Human-readable labels for the activity feed. */
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  SPACE_CREATED: "Created a space",
  SPACE_UPDATED: "Updated a space",
  SPACE_DELETED: "Deleted a space",
  PROJECT_CREATED: "Created a project",
  PROJECT_UPDATED: "Updated a project",
  PROJECT_DELETED: "Deleted a project",
  MATERIAL_UPLOADED: "Uploaded material",
  MATERIAL_READY: "Material ready",
  MATERIAL_FAILED: "Material processing failed",
  TUTOR_MESSAGE: "Asked the Tutor",
  UNSUPPORTED_QUESTION: "Tutor found no supporting evidence",
  QUIZ_STARTED: "Started a quiz",
  QUIZ_COMPLETED: "Completed a quiz",
  ANSWER_GRADED: "Answer graded",
  MASTERY_UPDATED: "Mastery updated",
  RECOMMENDATION_CREATED: "New recommendation",
  JOB_FAILED: "Background job failed",
};

/** Resolves a stored event type to a label, tolerating values from older rows. */
export function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type as ActivityType] ?? type;
}
