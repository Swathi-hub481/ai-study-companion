import { ZodError } from "zod";

/**
 * Error taxonomy. Every service throws a typed `AppError`; the API layer converts
 * it to a response in exactly one place (lib/http.ts), so status codes and payload
 * shapes stay consistent across the whole API.
 *
 * Intentionally free of framework imports: the background worker and CLI scripts
 * use this module too, and must not pull in `next/server`.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "AI_ERROR"
  | "AI_INVALID_OUTPUT"
  | "INSUFFICIENT_EVIDENCE"
  | "JOB_ERROR"
  | "STORAGE_ERROR"
  | "DOCUMENT_ERROR"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  AI_ERROR: 502,
  AI_INVALID_OUTPUT: 502,
  INSUFFICIENT_EVIDENCE: 200,
  JOB_ERROR: 500,
  STORAGE_ERROR: 500,
  DOCUMENT_ERROR: 500,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Whether the message is safe to show an end user verbatim. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request was invalid.", details?: unknown) {
    super("VALIDATION_ERROR", message, { details });
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request.", details?: unknown) {
    super("BAD_REQUEST", message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must be signed in.") {
    super("UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super("FORBIDDEN", message);
  }
}

/**
 * Note: "not found" and "not yours" intentionally collapse into the same error.
 * Distinguishing them would let a caller probe for the existence of other users'
 * resources.
 */
export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("NOT_FOUND", `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = "That already exists.") {
    super("CONFLICT", message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "The uploaded file is too large.") {
    super("PAYLOAD_TOO_LARGE", message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "That file type is not supported.") {
    super("UNSUPPORTED_MEDIA_TYPE", message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please slow down.") {
    super("RATE_LIMITED", message);
  }
}

export class AiError extends AppError {
  constructor(message = "The AI provider failed.", options: { cause?: unknown } = {}) {
    super("AI_ERROR", message, { status: 502, expose: false, cause: options.cause });
  }
}

export class AiInvalidOutputError extends AppError {
  constructor(message = "The AI returned output that failed validation.", details?: unknown) {
    super("AI_INVALID_OUTPUT", message, { status: 502, expose: false, details });
  }
}

/** Raised when a Project's materials do not contain enough evidence to answer. */
export class InsufficientEvidenceError extends AppError {
  constructor(message = "This Project's materials do not contain enough evidence to answer.") {
    super("INSUFFICIENT_EVIDENCE", message);
  }
}

export class JobError extends AppError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("JOB_ERROR", message, { expose: false, cause: options.cause });
  }
}

/** Raised when document storage (local filesystem or object store) fails. */
export class StorageError extends AppError {
  constructor(message = "The file could not be stored.", options: { cause?: unknown } = {}) {
    super("STORAGE_ERROR", message, { expose: false, cause: options.cause });
  }
}

/** Raised when a document cannot be parsed or its content cannot be extracted. */
export class DocumentProcessingError extends AppError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("DOCUMENT_ERROR", message, { expose: false, cause: options.cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Formats Zod issues into a compact `{ path: message }` map for API consumers. */
export function formatZodIssues(error: ZodError): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const issue of error.issues) {
    formatted[issue.path.join(".") || "(root)"] = issue.message;
  }
  return formatted;
}

/** Status code that `toErrorResponse` will use for a given error. */
export function httpStatusFor(error: unknown): number {
  if (error instanceof ZodError) return DEFAULT_STATUS.VALIDATION_ERROR;
  if (isAppError(error)) return error.status;
  return 500;
}
