import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/**
 * Materials loading state.
 *
 * Mirrors the real page: a heading with the upload control beside it, then the single
 * panel of file rows. A generic card grid would be a worse lie than no skeleton at all.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-5">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton className="h-10 w-full max-w-xs rounded-lg" />
        </div>
      </div>

      <SkeletonRows count={5} />
    </div>
  );
}
