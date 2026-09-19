import { describe, expect, it } from "vitest";
import { parseSseFrames, readSseStream, type SseEvent } from "@/lib/sse-client";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSseStream(stream)) events.push(event);
  return events;
}

describe("parseSseFrames", () => {
  it("parses a complete frame", () => {
    const { events, remainder } = parseSseFrames('event: delta\ndata: {"text":"hi"}\n\n');

    expect(events).toEqual([{ event: "delta", data: '{"text":"hi"}' }]);
    expect(remainder).toBe("");
  });

  it("parses several frames from one chunk", () => {
    const { events } = parseSseFrames("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");

    expect(events.map((event) => event.event)).toEqual(["a", "b"]);
  });

  it("retains an incomplete frame as the remainder", () => {
    const { events, remainder } = parseSseFrames("event: a\ndata: 1\n\nevent: b\ndata: 2");

    expect(events).toHaveLength(1);
    expect(remainder).toContain("event: b");
  });

  it("defaults the event name and ignores comment lines", () => {
    const { events } = parseSseFrames(": keep-alive\ndata: hello\n\n");

    expect(events).toEqual([{ event: "message", data: "hello" }]);
  });

  it("joins multi-line data with newlines", () => {
    const { events } = parseSseFrames("data: line one\ndata: line two\n\n");

    expect(events[0]?.data).toBe("line one\nline two");
  });

  it("normalises CRLF line endings", () => {
    const { events } = parseSseFrames("event: delta\r\ndata: hi\r\n\r\n");

    expect(events).toEqual([{ event: "delta", data: "hi" }]);
  });
});

describe("readSseStream", () => {
  it("reassembles events split across chunks", async () => {
    const events = await collect(
      streamOf(
        "event: delta\nda",
        'ta: {"text":"hello"}\n\n',
        'event: done\ndata: {"messageId":"m1"}\n\n',
      ),
    );

    expect(events).toEqual([
      { event: "delta", data: '{"text":"hello"}' },
      { event: "done", data: '{"messageId":"m1"}' },
    ]);
  });

  it("flushes a final frame that has no trailing blank line", async () => {
    const events = await collect(streamOf('event: done\ndata: {"ok":true}'));

    expect(events).toEqual([{ event: "done", data: '{"ok":true}' }]);
  });
});
