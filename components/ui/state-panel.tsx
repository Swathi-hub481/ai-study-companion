import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The frame every out-of-band state shares: an icon chip, an optional eyebrow, a heading,
 * an explanation and the actions available.
 *
 * Loading, empty, error and not-found states are different messages but the same
 * component, which is what stops four of them drifting into four different looks. It
 * holds no state and has no hooks, so it renders in a server component and inside a
 * client error boundary alike.
 */
type Tone = "neutral" | "brand" | "danger" | "warning";

const CHIP: Record<Tone, string> = {
  neutral:
    "border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
  brand: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  warning:
    "border-[var(--color-warning)]/35 bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
  danger:
    "border-[var(--color-danger)]/35 bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
};

const EYEBROW: Record<Tone, string> = {
  neutral: "text-[var(--color-ink-subtle)]",
  brand: "text-[var(--color-brand-600)]",
  warning: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
};

export function StatePanel({
  icon: Icon,
  tone = "neutral",
  eyebrow,
  title,
  body,
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  eyebrow?: string;
  title: string;
  body: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl border",
            CHIP[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      ) : null}

      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <p className={cn("text-[11px] font-semibold tracking-[0.08em] uppercase", EYEBROW[tone])}>
            {eyebrow}
          </p>
        ) : null}

        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>

        <p className="max-w-prose text-sm leading-6 text-[var(--color-ink-muted)]">{body}</p>
      </div>

      {children ? <div className="flex flex-wrap gap-3">{children}</div> : null}
    </div>
  );
}
