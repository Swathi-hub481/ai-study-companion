import { cn } from "@/lib/utils";

/**
 * Loading placeholders.
 *
 * Skeletons mirror the shape of the content that is coming, so the layout does not jump
 * when it arrives. They are `aria-hidden` and the surrounding region announces the wait
 * once — a screen reader should hear "loading", not fourteen empty boxes.
 *
 * The named shapes below exist so a route's `loading.tsx` can describe its own layout
 * without every one of them re-inventing a card or a stat block.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-surface-muted)] ring-1 ring-inset ring-[oklch(1_0_0/0.03)]",
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-3.5", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** A page heading: eyebrow, title, one line of description. */
export function SkeletonHeading({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-64 max-w-full" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

/** A row of statistic cards. Two-up on phones, matching the real grids. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card flex flex-col items-start gap-2.5 p-4">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardList({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="mt-2 h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A tall card of stacked rows — a list, a table or a transcript. */
export function SkeletonRows({
  count = 4,
  avatar = true,
  className,
}: {
  count?: number;
  avatar?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("card flex flex-col p-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3.5">
          {avatar ? <Skeleton className="size-9 shrink-0 rounded-lg" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A framed block, for a chart or a panel whose content is unknown. */
export function SkeletonPanel({
  height = "h-56",
  className,
}: {
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("card flex flex-col gap-4 p-5", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className={cn("w-full rounded-lg", height)} />
    </div>
  );
}
