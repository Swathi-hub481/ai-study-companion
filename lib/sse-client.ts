/**
 * A minimal Server-Sent Events reader for the browser and tests.
 *
 * `EventSource` cannot issue a POST, and the Tutor request carries a body, so the
 * route's stream is consumed with `fetch` + a stream reader instead. This module
 * turns that byte stream back into discrete events.
 *
 * No server imports — safe in a client bundle.
 */

export type SseEvent = {
  /** The `event:` field, defaulting to "message" per the SSE spec. */
  event: string;
  /** The `data:` field(s), joined with newlines. */
  data: string;
};

/**
 * Splits accumulated text into complete SSE frames.
 *
 * Returns the events that are fully terminated by a blank line, plus whatever is
 * left over — a frame can arrive split across two chunks, so the caller must retain
 * the remainder and prepend it to the next read.
 */
export function parseSseFrames(text: string): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];

  // Frames are separated by a blank line. Normalise CRLF so a proxy that rewrites
  // line endings does not break parsing.
  const normalised = text.replace(/\r\n/g, "\n");
  const parts = normalised.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const frame of parts) {
    let event = "message";
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;

      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      let value = separator === -1 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }

    if (data.length > 0) {
      events.push({ event, data: data.join("\n") });
    }
  }

  return { events, remainder };
}

/** Reads a fetch Response body and yields each SSE event as it arrives. */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSseFrames(buffer);
      buffer = remainder;

      for (const event of events) {
        yield event;
      }
    }

    // A final frame may arrive without its terminating blank line.
    buffer += decoder.decode();
    const { events } = parseSseFrames(`${buffer}\n\n`);

    for (const event of events) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
