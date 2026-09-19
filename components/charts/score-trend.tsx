import { formatDate } from "@/lib/utils";

/**
 * A score-over-time line with a filled area beneath it.
 *
 * Server-rendered SVG, matching the other charts here — the series is at most a couple of
 * dozen graded answers, so a polyline and a path are the whole implementation and no
 * charting library needs to reach the browser.
 *
 * The y-axis is pinned to 0–100% rather than scaled to the data, because a score is only
 * meaningful against its ceiling: a line that filled the box from 40% to 45% would flatter
 * a flat run of answers.
 */

const WIDTH = 560;
const HEIGHT = 220;
const PAD_X = 44;
const PAD_Y = 18;
const GRID = [0, 0.25, 0.5, 0.75, 1];

export type ScorePoint = {
  /** ISO timestamp of when the answer was graded. */
  at: string;
  /** 0..1 */
  score: number;
};

export function ScoreTrend({
  points,
  label = "Score trend",
}: {
  points: ScorePoint[];
  label?: string;
}) {
  if (points.length < 2) {
    return (
      <p className="flex aspect-[560/220] items-center justify-center text-sm text-[var(--color-ink-subtle)]">
        Not enough graded answers yet to plot a trend.
      </p>
    );
  }

  const innerWidth = WIDTH - PAD_X * 2;
  const innerHeight = HEIGHT - PAD_Y * 2;

  const plotted = points.map((point, index) => ({
    x: PAD_X + (index / (points.length - 1)) * innerWidth,
    y: PAD_Y + (1 - Math.min(1, Math.max(0, point.score))) * innerHeight,
  }));

  const line = plotted.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${PAD_X},${PAD_Y + innerHeight} ${line} ${PAD_X + innerWidth},${PAD_Y + innerHeight}`;

  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${label}: ${points.length} graded answers, from ${Math.round(
        first.score * 100,
      )}% to ${Math.round(last.score * 100)}%`}
    >
      <defs>
        <linearGradient id="score-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gridlines and the percentage scale */}
      {GRID.map((fraction) => {
        const y = PAD_Y + (1 - fraction) * innerHeight;

        return (
          <g key={fraction}>
            <line
              x1={PAD_X}
              y1={y}
              x2={PAD_X + innerWidth}
              y2={y}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
            <text
              x={PAD_X - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-[var(--color-ink-subtle)]"
              style={{ fontSize: 10 }}
            >
              {Math.round(fraction * 100)}%
            </text>
          </g>
        );
      })}

      <polygon points={area} fill="url(#score-area)" />

      <polyline
        points={line}
        fill="none"
        stroke="var(--color-brand-500)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {plotted.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={2.5}
          fill="var(--color-brand-600)"
          stroke="var(--color-surface)"
          strokeWidth={1}
        />
      ))}

      {/* First and last dates only: a label per point would collide. */}
      <text
        x={PAD_X}
        y={HEIGHT - 3}
        textAnchor="start"
        className="fill-[var(--color-ink-subtle)]"
        style={{ fontSize: 10 }}
      >
        {formatDate(first.at)}
      </text>
      <text
        x={PAD_X + innerWidth}
        y={HEIGHT - 3}
        textAnchor="end"
        className="fill-[var(--color-ink-subtle)]"
        style={{ fontSize: 10 }}
      >
        {formatDate(last.at)}
      </text>
    </svg>
  );
}
