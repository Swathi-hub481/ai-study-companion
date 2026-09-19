/**
 * Thin client for the app's JSON API.
 *
 * Imports nothing server-side — only `fetch` — so any client component can use it.
 * Centralises the two things every form must get right: unwrapping the
 * `{ data }` / `{ error }` envelope, and surfacing a usable message when the network
 * itself fails.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; details?: Record<string, string> };

type Envelope<T> = { data: T };
type ErrorEnvelope = { error?: { message?: string; details?: Record<string, string> } };

/**
 * A request that never resolves is worse than one that fails: the learner sees a spinner
 * forever and no error to act on. Twenty seconds is far longer than any JSON endpoint
 * here needs, and much shorter than a user's patience.
 */
const REQUEST_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const hasBody = options.body !== undefined;
  let response: Response;

  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout is a specific, actionable failure — say so rather than blaming the
    // connection, which would send the user to check something that is fine.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return {
        ok: false,
        message: "The server took too long to respond. Please try again.",
      };
    }

    return {
      ok: false,
      message: "Could not reach the server. Check your connection and try again.",
    };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  const payload = (await response.json().catch(() => null)) as
    | (Envelope<T> & ErrorEnvelope)
    | null;

  if (!response.ok) {
    return {
      ok: false,
      message: payload?.error?.message ?? "Something went wrong. Please try again.",
      details: payload?.error?.details,
    };
  }

  return { ok: true, data: (payload as Envelope<T>).data };
}
