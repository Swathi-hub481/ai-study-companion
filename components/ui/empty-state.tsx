import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty state.
 *
 * An empty screen is an invitation, not a dead end: it states what belongs here and
 * offers the action that fills it. `compact` is for a section inside a populated
 * page, where the full frame would be heavy.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
  compact = false,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  children?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-inset)]/50 text-center",
        compact ? "px-5 py-7" : "px-6 py-12",
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
        <p className="mx-auto max-w-md text-[13px] leading-5 text-[var(--color-ink-muted)]">
          {body}
        </p>
      </div>

      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
