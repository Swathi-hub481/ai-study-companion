import type { MasteryPoint } from "@/lib/learning/growth";

const WIDTH = 168;
const HEIGHT = 44;
const PADDING = 5;

/**
 * A sparkline of a concept's mastery history.
 *
 * Deliberately small and unlabelled: the exact value sits in the bar beside it, so this
 * exists to show *direction*. Forty lines of SVG is a smaller cost than a charting
 * library, and it renders in a server component with no client JavaScript.
 *
 * §3.3 names `recharts` for the analytics charts; that is deferred to Phase 9, where the
 * heatmap and radar plots actually need it.
 */
export function MasteryTrend({ series, label }: { series: MasteryPoint[]; label: string }) {
  if (series.length < 2) {
    return <span className="text-xs text-[var(--color-ink-subtle)]">Not enough history</span>;
  }

  const points = series.map((point, index) => ({
    x: PADDING + (index / (series.length - 1)) * (WIDTH - PADDING * 2),
    y: HEIGHT - PADDING - Math.min(Math.max(point.mastery, 0), 1) * (HEIGHT - PADDING * 2),
  }));

  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`${label}: mastery trend across ${series.length} observations`}
      className="shrink-0"
    >
      {/* A baseline so a flat line reads as "flat", not as "no data". */}
      <line
        x1={PADDING}
        y1={HEIGHT - PADDING}
        x2={WIDTH - PADDING}
        y2={HEIGHT - PADDING}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />

      <polyline
        points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--color-brand-500)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx={first.x} cy={first.y} r={2} fill="var(--color-brand-300)" />
      <circle
        cx={last.x}
        cy={last.y}
        r={3}
        fill="var(--color-brand-600)"
        stroke="var(--color-surface)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
