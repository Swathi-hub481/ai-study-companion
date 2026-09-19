import { cn } from "@/lib/utils";

/**
 * Label + control + hint + validation message.
 *
 * The error carries `role="alert"` so a failed submission is announced rather than
 * only displayed. Callers wire `aria-describedby` to `${htmlFor}-error` / `${htmlFor}-hint`
 * on the control — the ids are derived from `htmlFor` so they are predictable.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  optional = false,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-[var(--color-ink)]">
          {label}
        </label>
        {optional ? (
          <span className="text-[11px] text-[var(--color-ink-subtle)]">Optional</span>
        ) : null}
      </div>

      {children}

      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-[var(--color-ink-subtle)]">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-[var(--color-danger-ink)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
