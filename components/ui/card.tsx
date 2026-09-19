import { cn } from "@/lib/utils";

/**
 * Card shell.
 *
 * Compose the pieces rather than passing a dozen props: `CardHeader` lays the title
 * and its action out on one line, `CardContent` owns the body padding, and
 * `interactive` switches the whole surface into its hover state for cards that are
 * themselves links.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn(interactive ? "card-interactive" : "card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-[15px] leading-6 font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]", className)}
      {...props}
    />
  );
}

/** Right-aligned slot in a CardHeader for a single action (link, button, badge). */
export function CardAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-center gap-2", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-[var(--color-border-subtle)] px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
