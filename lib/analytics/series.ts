/**
 * Time-series helpers for the analytics views.
 *
 * Prisma-free and unit-tested, so the charts and the analytics service share one
 * implementation of "what counts as a day" instead of each doing its own arithmetic.
 * All bucketing is UTC, so a series does not shift shape with the viewer's timezone.
 */

export type DayBucket = {
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  date: Date;
  count: number;
};

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = {
  /** Column, oldest first. */
  week: number;
  /** Row, 0 = Sunday. */
  weekday: number;
  day: string;
  count: number;
  level: HeatmapLevel;
};

export function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * Counts entries into calendar days, oldest first, **including days with no activity**.
 *
 * Empty days matter: a heatmap with gaps removed would compress a quiet month and imply
 * consistency that is not there.
 */
export function bucketByDay(
  entries: Array<{ createdAt: Date }>,
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  if (days <= 0) return [];

  const buckets = new Map<string, DayBucket>();
  const start = startOfUtcDay(new Date(now.getTime() - (days - 1) * 86_400_000));

  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getTime() + index * 86_400_000);
    buckets.set(dayKey(date), { day: dayKey(date), date, count: 0 });
  }

  for (const entry of entries) {
    const bucket = buckets.get(dayKey(entry.createdAt));
    if (bucket) bucket.count += 1;
  }

  return [...buckets.values()];
}

/** Scale-relative intensity: a quiet week still shows contrast, unlike fixed thresholds. */
function levelFor(count: number, max: number): HeatmapLevel {
  if (count <= 0) return 0;

  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Lays day buckets out as a calendar grid: columns are weeks, rows are weekdays.
 *
 * The first column is padded so each weekday stays on its own row — without that, the
 * same row would represent a different weekday in different columns.
 */
export function buildHeatmap(buckets: DayBucket[]): { cells: HeatmapCell[]; weeks: number } {
  if (buckets.length === 0) return { cells: [], weeks: 0 };

  const first = buckets[0]!;
  const leadingBlanks = first.date.getUTCDay();
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  const cells = buckets.map((bucket, index) => {
    const position = index + leadingBlanks;

    return {
      week: Math.floor(position / 7),
      weekday: position % 7,
      day: bucket.day,
      count: bucket.count,
      level: levelFor(bucket.count, max),
    };
  });

  return { cells, weeks: Math.max(...cells.map((cell) => cell.week)) + 1 };
}

/** Total across a series — the denominator for "per day" figures. */
export function totalCount(buckets: DayBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}
