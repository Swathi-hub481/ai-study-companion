import { logger } from "@/lib/logger";

/**
 * Lightweight server-side timing instrumentation.
 *
 * Purpose: measure where a request's wall-clock time actually goes, so optimisations
 * target verified bottlenecks rather than assumed ones.
 *
 * Three properties matter:
 *
 *  - **Negligible overhead.** When no session is passed in, `time()` is a direct call
 *    through to the wrapped function — no clock reads, no allocation. Every instrumented
 *    path must keep working unchanged when timing is switched off, which is what makes
 *    it safe to leave in production code.
 *  - **Nested by construction.** A span records the depth it was opened at, so a
 *    breakdown reads as a tree without any parent bookkeeping at the call site.
 *  - **Never user-visible.** Reports go to the structured log and to explicit consumers
 *    (scripts, tests). Nothing here is serialised into an HTTP response.
 */

export type TimingSpan = {
  name: string;
  durationMs: number;
  /** Nesting level: 0 is a span opened directly on the session. */
  depth: number;
  /** Milliseconds from session start to when this span opened. */
  startedAtMs: number;
};

export type TimingReport = {
  label: string;
  totalMs: number;
  spans: TimingSpan[];
};

const round = (value: number) => Math.round(value * 100) / 100;

export class TimingSession {
  readonly label: string;
  private readonly startedAt = performance.now();
  private readonly spans: TimingSpan[] = [];
  private depth = 0;

  constructor(label: string) {
    this.label = label;
  }

  /** Milliseconds since the session began. */
  elapsed(): number {
    return round(performance.now() - this.startedAt);
  }

  private push(name: string, startedAt: number, depth: number): void {
    this.spans.push({
      name,
      durationMs: round(performance.now() - startedAt),
      depth,
      startedAtMs: round(startedAt - this.startedAt),
    });
  }

  /** Times an async operation. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const depth = this.depth;
    this.depth += 1;

    try {
      return await fn();
    } finally {
      this.depth = depth;
      this.push(name, startedAt, depth);
    }
  }

  /** Times a synchronous operation. */
  timeSync<T>(name: string, fn: () => T): T {
    const startedAt = performance.now();
    const depth = this.depth;
    this.depth += 1;

    try {
      return fn();
    } finally {
      this.depth = depth;
      this.push(name, startedAt, depth);
    }
  }

  /** Records an instant — useful for "first token" style milestones. */
  mark(name: string): void {
    this.push(name, this.startedAt, this.depth);
  }

  /** Records a duration measured elsewhere (e.g. around a stream consumer). */
  record(name: string, durationMs: number): void {
    this.spans.push({
      name,
      durationMs: round(durationMs),
      depth: this.depth,
      startedAtMs: this.elapsed(),
    });
  }

  /** Spans in the order they closed, which reads as a call tree. */
  report(): TimingReport {
    return { label: this.label, totalMs: this.elapsed(), spans: [...this.spans] };
  }
}

export function beginTiming(label: string): TimingSession {
  return new TimingSession(label);
}

/**
 * Whether instrumentation should run at all.
 *
 * Off in production unless explicitly switched on: timing is a development and
 * verification tool, and a production deployment should not pay for reports nobody
 * reads. `PERF_TIMING=1` turns it on for a measurement run.
 */
export function isTimingEnabled(): boolean {
  if (process.env.PERF_TIMING === "1") return true;
  if (process.env.PERF_TIMING === "0") return false;

  return process.env.NODE_ENV !== "production";
}

/** Times a call against an optional session, or runs it directly when there is none. */
export async function timed<T>(
  session: TimingSession | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return session ? session.time(name, fn) : fn();
}

/**
 * Runs a span against an optional session. Convenience for the common shape where the
 * caller may or may not have a session in hand.
 */
export function timedSync<T>(session: TimingSession | undefined, name: string, fn: () => T): T {
  return session ? session.timeSync(name, fn) : fn();
}

/** Human-readable breakdown, ordered by when each span closed. */
export function formatTimingReport(report: TimingReport): string {
  const width = report.spans.reduce((max, span) => Math.max(max, span.name.length), 0);

  const lines = report.spans.map(
    (span) =>
      `${"  ".repeat(span.depth)}${span.name.padEnd(width + span.depth * 2)} ${String(span.durationMs).padStart(9)}ms`,
  );

  return [`TIMING ${report.label}`, `total ${report.totalMs}ms`, ...lines].join("\n");
}

/** Logs a report at debug level; never throws, never blocks. */
export function logTimingReport(report: TimingReport): void {
  if (!isTimingEnabled()) return;

  logger.debug(
    {
      label: report.label,
      totalMs: report.totalMs,
      spans: report.spans,
    },
    "Timing report",
  );
}

// ---------------------------------------------------------------------------
// Analysis helpers, used by the measurement harness
// ---------------------------------------------------------------------------

export type SampleStats = {
  count: number;
  minMs: number;
  medianMs: number;
  meanMs: number;
  maxMs: number;
};

export function summarise(samples: number[]): SampleStats {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, medianMs: 0, meanMs: 0, maxMs: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);

  return {
    count: sorted.length,
    minMs: round(sorted[0]!),
    medianMs: round(
      sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    ),
    meanMs: round(total / sorted.length),
    maxMs: round(sorted[sorted.length - 1]!),
  };
}
