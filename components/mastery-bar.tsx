import { ProgressBar } from "@/components/ui/progress";
import { masteryBand } from "@/lib/utils";

const BAND_COLOURS = {
  low: "var(--color-mastery-low)",
  mid: "var(--color-mastery-mid)",
  high: "var(--color-mastery-high)",
} as const;

/**
 * Mastery is an estimate, not a measurement, so the bar is deliberately coarse: a single
 * fill, a whole-number percentage, and an accessible `progressbar` role. The band colour
 * reinforces the value but never carries it alone.
 */
export function MasteryBar({
  value,
  label,
  showValue = true,
  hint,
}: {
  value: number;
  label?: string;
  showValue?: boolean;
  hint?: React.ReactNode;
}) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  const band = masteryBand(value);

  return (
    <div className="flex flex-col gap-1.5">
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {label ? (
            <span className="truncate font-medium text-[var(--color-ink)]">{label}</span>
          ) : (
            <span />
          )}
          {showValue ? (
            <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
              {percent}%
            </span>
          ) : null}
        </div>
      ) : null}

      <ProgressBar value={value} label={label ? `${label} mastery` : "Mastery"} colour={BAND_COLOURS[band]} />

      {hint ? <p className="text-xs text-[var(--color-ink-subtle)]">{hint}</p> : null}
    </div>
  );
}

/** Compact mastery readout for cards, without the labelled bar. */
export function MasteryStat({ value, caption }: { value: number; caption: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl leading-none font-semibold tabular-nums">{percent}%</span>
      <span className="text-xs text-[var(--color-ink-subtle)]">{caption}</span>
    </div>
  );
}
