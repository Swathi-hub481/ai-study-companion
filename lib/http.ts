import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { BadRequestError, formatZodIssues, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The single place where API responses are shaped.
 *
 * Success:  { data: <payload> }
 * Failure:  { error: { code, message, details? } }
 *
 * Route handlers stay thin by wrapping their body in `route(...)`.
 */

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T): NextResponse {
  return ok(data, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Converts anything thrown into the uniform error envelope. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json<ApiErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request was invalid.",
          details: formatZodIssues(error),
        },
      },
      { status: 422 },
    );
  }

  if (isAppError(error)) {
    // Log server faults in full; never leak their internals to the client.
    if (!error.expose || error.status >= 500) {
      logger.error({ err: error, code: error.code }, error.message);
    }

    return NextResponse.json<ApiErrorBody>(
      {
        error: {
          code: error.code,
          message: error.expose ? error.message : "Something went wrong.",
          ...(error.expose && error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }

  logger.error({ err: error }, "Unhandled API error");

  return NextResponse.json<ApiErrorBody>(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
    { status: 500 },
  );
}

/** Wraps a handler so every thrown error becomes a correctly shaped response. */
export async function route(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Parses and validates a JSON request body. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }

  return schema.parse(body);
}

/** Parses and validates URL search params. */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return schema.parse(params);
}

/**
 * Best-effort client IP, used for rate-limit keys and session records.
 *
 * `x-forwarded-for` is client-controllable, so this is only trustworthy when the
 * app sits behind a proxy that overwrites the header. An attacker able to spoof it
 * can vary their rate-limit key, which is precisely why rate limiting is treated as
 * abuse mitigation rather than a security boundary.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Session metadata captured at sign-in, for auditing. */
export function clientMetadata(request: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  const userAgent = request.headers.get("user-agent");

  return {
    userAgent: userAgent ? userAgent.slice(0, 300) : null,
    ipAddress: clientIp(request),
  };
}
