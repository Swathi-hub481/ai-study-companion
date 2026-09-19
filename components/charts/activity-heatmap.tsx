import { CalendarDays } from "lucide-react";
import type { DayBucket, HeatmapLevel } from "@/lib/analytics/series";
import { buildHeatmap } from "@/lib/analytics/series";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

/**
 * Calendar heatmap of daily activity.
 *
 * Columns are weeks and rows are weekdays, so a pattern like "nothing on Sundays" is
 * visible at a glance. Intensity is relative to the busiest day in the window rather than
 * fixed thresholds, so a quiet month still shows contrast.
 *
 * Server-rendered SVG: no client JavaScript for a grid of rectangles.
 */

const CELL = 12;
const GAP = 3;
/** Left gutter that holds the weekday labels. */
const GUTTER = 30;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Days to print in the gutter, so the rows stay legible without crowding. */
const LABELLED_WEEKDAYS = [1, 3, 5];
const LEVELS: HeatmapLevel[] = [0, 1, 2, 3, 4];

const LEVEL_OPACITY: Record<HeatmapLevel, number> = {
  0: 0.06,
  1: 0.25,
  2: 0.45,
  3: 0.7,
  4: 1,
};

export function ActivityHeatmap({ buckets }: { buckets: DayBucket[] }) {
  const { cells, weeks } = buildHeatmap(buckets);

  if (cells.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarDays}
        title="No activity to plot yet"
        body="Activity will appear here once there is something to show in this window."
      />
    );
  }

  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const gridWidth = weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);
  const width = GUTTER + gridWidth;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Daily activity over the last ${cells.length} days: ${total} event${
            total === 1 ? "" : "s"
          } in total`}
          preserveAspectRatio="xMinYMin meet"
          style={{ maxWidth: width }}
        >
          {LABELLED_WEEKDAYS.map((weekday) => (
            <text
              key={weekday}
              x={GUTTER - 6}
              y={weekday * (CELL + GAP) + CELL / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-[var(--color-ink-subtle)]"
              style={{ fontSize: 9 }}
            >
              {WEEKDAYS[weekday]}
            </text>
          ))}

          {cells.map((cell) => (
            <rect
              key={cell.day}
              x={GUTTER + cell.week * (CELL + GAP)}
              y={cell.weekday * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2.5}
              fill={cell.level === 0 ? "var(--color-surface-sunken)" : "var(--color-brand-600)"}
              fillOpacity={cell.level === 0 ? 1 : LEVEL_OPACITY[cell.level]}
            >
              <title>{`${formatDate(cell.day)}: ${cell.count} event${cell.count === 1 ? "" : "s"}`}</title>
            </rect>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--color-ink-subtle)]">
        <span>Each column is a week, each row a weekday.</span>

        <span className="flex items-center gap-1.5">
          <span>Less</span>
          {LEVELS.map((level) => (
            <span
              key={level}
              aria-hidden="true"
              className="size-3 rounded-[3px]"
              style={{
                backgroundColor:
                  level === 0 ? "var(--color-surface-sunken)" : "var(--color-brand-600)",
                opacity: level === 0 ? 1 : LEVEL_OPACITY[level],
              }}
            />
          ))}
          <span>More</span>
        </span>
      </div>
    </div>
  );
}
