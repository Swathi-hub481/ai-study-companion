import { Skeleton } from "@/components/ui/skeleton";

/**
 * Tutor loading state.
 *
 * The Tutor is a two-column workspace — conversation history beside the thread — so the
 * skeleton shows that shape rather than a card grid.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <div className="card hidden flex-col gap-2 p-3 lg:flex">
          <Skeleton className="mb-1 h-3 w-32" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-lg px-2.5 py-2">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>

        <div className="card flex flex-col">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-3/5 rounded-xl" />
            </div>
            <div className="flex gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex w-4/5 flex-col gap-2 rounded-xl p-1">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="mt-1 h-6 w-40 rounded-full" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] p-4 sm:p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="flex justify-end">
              <Skeleton className="h-11 w-28 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
