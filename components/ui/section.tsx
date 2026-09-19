import { cn } from "@/lib/utils";

/**
 * A titled block inside a page.
 *
 * Some content reads better as an open section (no card chrome) and some as a raised
 * panel. `variant` picks between them so the two never get mixed within one screen by
 * accident.
 */
export function Section({
  title,
  description,
  action,
  children,
  variant = "panel",
  className,
  bodyClassName,
  ...rest
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  variant?: "panel" | "plain";
  className?: string;
  bodyClassName?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4",
        variant === "panel" && "panel px-5 py-5",
        className,
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[15px] leading-6 font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-[13px] leading-5 text-[var(--color-ink-muted)]">
              {description}
            </p>
          ) : null}
        </div>

        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}
