import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Search } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { listSpaces } from "@/lib/services/spaces";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpaceCard } from "@/components/spaces/space-card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Spaces" };

type PageProps = { searchParams: Promise<{ q?: string }> };

/**
 * Spaces index.
 *
 * The search is a plain `GET` form, matching the pattern the admin views already use:
 * the query lives in the URL, the page stays a server component, and the filter runs
 * over the Spaces that were fetched anyway. That keeps the whole screen server-rendered
 * — no extra client boundary, no second request, and no new query against the database.
 */
export default async function SpacesPage({ searchParams }: PageProps) {
  const user = await requireUserPage();
  const { q } = await searchParams;

  const spaces = await listSpaces(user.id);

  const query = (q ?? "").trim();
  const needle = query.toLowerCase();
  const visible = needle
    ? spaces.filter(
        ({ space }) =>
          space.name.toLowerCase().includes(needle) ||
          space.description.toLowerCase().includes(needle),
      )
    : spaces;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">My Spaces</h1>
        <CreateSpaceForm defaultOpen={spaces.length === 0} label="Create Space" />
      </header>

      {spaces.length > 0 ? (
        <form method="get" role="search" className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-ink-subtle)]"
            />
            <label htmlFor="space-search" className="sr-only">
              Search spaces
            </label>
            <input
              id="space-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search spaces..."
              className="h-10 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-inset)] pr-3 pl-9 text-sm text-[var(--color-ink)] shadow-xs transition-[border-color,box-shadow] placeholder:text-[var(--color-ink-subtle)] hover:border-[var(--color-ink-subtle)]/60 focus:border-[var(--color-brand-500)] focus:ring-4 focus:ring-[var(--color-brand-500)]/20 focus:outline-none"
            />
          </div>

          {query ? (
            <Link
              href="/spaces"
              className="text-[13px] text-[var(--color-ink-subtle)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </form>
      ) : null}

      {spaces.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No spaces yet"
          body="Create a space for any area you want to learn, then add a project inside it. A project is where materials, tutoring, and assessment live."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No spaces match that search"
          body={`Nothing matched "${query}". Try a different word, or clear the search to see every space.`}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(({ space, projectCount, materialCount }) => (
            <li key={space.id}>
              <SpaceCard
                spaceId={space.id}
                name={space.name}
                color={space.color}
                projectCount={projectCount}
                materialCount={materialCount}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
