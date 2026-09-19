import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger";

const TONE_CHIP: Record<Tone, string> = {
  neutral:
    "border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
  brand: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  accent:
    "border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
  success:
    "border-[var(--color-success)]/35 bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
  warning:
    "border-[var(--color-warning)]/35 bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
  danger:
    "border-[var(--color-danger)]/35 bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
};

/**
 * A single measure.
 *
 * The icon chip carries the tone; the number carries the hierarchy and the label
 * supports it. `tone` is reserved for values whose colour means something (a failure
 * count), so a dashboard of neutral tiles does not turn into a colour wheel.
 *
 * Below `sm` the tile stacks. These sit two-up on a phone, and at that width the chip
 * would leave the number barely fifty pixels — enough for "12", not for "1,234". Stacking
 * hands the value the full tile.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "card flex flex-col items-start gap-2.5 p-4 sm:flex-row sm:items-center sm:gap-3.5",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full border",
            TONE_CHIP[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      ) : null}

      <div className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate text-[11px] font-medium tracking-wide text-[var(--color-ink-subtle)] uppercase">
          {label}
        </span>
        <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {hint ? (
          <span className="mt-0.5 text-xs leading-4 text-[var(--color-ink-subtle)]">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}
