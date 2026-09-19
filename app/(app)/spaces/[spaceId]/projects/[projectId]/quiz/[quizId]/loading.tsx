import { Skeleton } from "@/components/ui/skeleton";

/**
 * Quiz attempt loading state.
 *
 * Matches the runner: a summary bar with the progress indicator and the finish action,
 * then one question card. The stepper is deliberately not shown — it appears with the
 * real question count, and guessing it would be worse than showing nothing.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
        <Skeleton className="h-10 w-full rounded-lg sm:w-32" />
      </div>

      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-32 rounded-md" />
        </div>

        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />

        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] p-3.5"
            >
              <Skeleton className="size-6 shrink-0 rounded-lg" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
    </div>
  );
}
