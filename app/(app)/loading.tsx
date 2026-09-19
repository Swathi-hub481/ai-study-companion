import { SkeletonCardList, SkeletonHeading, SkeletonStats } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the authenticated area.
 *
 * Every page under `(app)` queries the database before it can render, so there is always a
 * gap between navigation and content. This is the *generic* shape — a heading, a row of
 * measures and a card grid — which is what the dashboard-like routes (Home, Spaces, a
 * Space, a Project) actually render. Routes whose layout differs (Tutor, Materials, a quiz
 * attempt, Admin) declare their own `loading.tsx` beside the page.
 *
 * The region announces the wait once rather than once per placeholder.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <SkeletonHeading />
      <SkeletonStats />
      <SkeletonCardList count={3} />
    </div>
  );
}
