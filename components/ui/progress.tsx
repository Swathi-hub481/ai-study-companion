import { cn } from "@/lib/utils";

/**
 * Determinate progress.
 *
 * Always carries the `progressbar` role and its value, so the bar is not a decorative
 * shape that only sighted users can read. The track is a recessed well; the fill takes
 * the caller's colour (usually a mastery band) and a faint matching glow, which is what
 * makes progress legible at a glance on a dark surface.
 */
export function ProgressBar({
  value,
  label,
  size = "md",
  colour = "var(--color-brand-500)",
  className,
}: {
  /** 0..1 */
  value: number;
  label: string;
  size?: "sm" | "md";
  colour?: string;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "w-full overflow-hidden rounded-full bg-[var(--color-surface-inset)] ring-1 ring-inset ring-[oklch(1_0_0/0.05)]",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${percent}%`,
          backgroundColor: colour,
          boxShadow: percent > 0 ? `0 0 12px -2px ${colour}` : undefined,
        }}
      />
    </div>
  );
}

/** A small inline percentage badge used beside a `ProgressBar`. */
export function ProgressValue({ value, className }: { value: number; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className={cn("text-xs tabular-nums text-[var(--color-ink-muted)]", className)}>
      {percent}%
    </span>
  );
}
