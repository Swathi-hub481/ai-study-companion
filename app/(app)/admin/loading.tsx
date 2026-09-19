import { Skeleton, SkeletonRows, SkeletonStats } from "@/components/ui/skeleton";

/**
 * Admin loading state.
 *
 * The admin area is dense — a heading, a row of instance totals and a table — so the
 * skeleton commits to that shape rather than the generic card grid.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <Skeleton className="h-11 w-full max-w-xl rounded-xl" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <SkeletonStats count={4} />
      <SkeletonRows count={5} avatar={false} />
    </div>
  );
}
