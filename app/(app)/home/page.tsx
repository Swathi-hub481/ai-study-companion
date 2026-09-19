import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Layers,
  ListChecks,
  MessageSquare,
  FolderKanban,
  Sparkles,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getHomeDashboard } from "@/lib/services/home";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Home" };

/** How many project cards the "Continue Learning" row shows. */
const CONTINUE_LIMIT = 3;

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Home dashboard.
 *
 * Follows the reference composition: greeting, a row of four statistic cards,
 * "Continue Learning", then "Quick Actions". Every value is real — the payload carries
 * a learner's own totals and projects, and nothing here invents a figure.
 *
 * The reference's "Recent Activity" list is deliberately absent: `getHomeDashboard`
 * does not return activity events, and adding a query for it would mean changing
 * data-fetching behaviour for a UI-only change. The same event log is already shown on
 * the Space and Project dashboards, which do fetch it.
 */
export default async function HomePage() {
  const user = await requireUserPage();
  const dashboard = await getHomeDashboard(user.id);

  const firstName = user.name.split(" ")[0];
  const hasSpaces = dashboard.spaces.length > 0;
  const isBrandNew = !hasSpaces && dashboard.recentProjects.length === 0;

  const active = dashboard.continueLearning;
  const otherProjects = dashboard.recentProjects
    .filter((tile) => tile.projectId !== active?.tile.projectId)
    .slice(0, CONTINUE_LIMIT - 1);

  const quickActions = active
    ? [
        {
          label: "Ask Tutor",
          href: `/spaces/${active.tile.spaceId}/projects/${active.tile.projectId}/tutor`,
          icon: MessageSquare,
        },
        {
          label: "Take Quiz",
          href: `/spaces/${active.tile.spaceId}/projects/${active.tile.projectId}/quiz`,
          icon: ListChecks,
        },
        {
          label: "Upload Material",
          href: `/spaces/${active.tile.spaceId}/projects/${active.tile.projectId}/materials`,
          icon: Upload,
        },
        {
          label: "View Growth",
          href: `/spaces/${active.tile.spaceId}/projects/${active.tile.projectId}/growth`,
          icon: TrendingUp,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting(new Date())}, {firstName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {isBrandNew
              ? "Create a space to start your first learning project."
              : "Keep going — here is where you left off."}
          </p>
        </div>

        <CreateSpaceForm defaultOpen={isBrandNew} />
      </header>

      {isBrandNew ? (
        <EmptyState
          icon={Sparkles}
          title="Create your first space"
          body="A space is a broad learning area. Create one, then add a project inside it with a goal — that is where materials, tutoring, and assessment live."
        />
      ) : (
        <>
          {/* Statistics */}
          <section aria-label="Your totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Spaces" value={dashboard.overall.spaces} icon={Layers} tone="brand" />
            <StatCard
              label="Projects"
              value={dashboard.overall.projects}
              icon={FolderKanban}
              tone="accent"
            />
            <StatCard
              label="Concepts"
              value={dashboard.overall.concepts}
              icon={Zap}
              tone="success"
            />
            <StatCard
              label="Average mastery"
              value={`${Math.round(dashboard.overall.averageMastery * 100)}%`}
              hint={`${dashboard.overall.readyMaterials} ready materials`}
              icon={TrendingUp}
              tone="warning"
            />
          </section>

          {/* Continue learning */}
          {active || otherProjects.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-base font-semibold tracking-tight">Continue Learning</h2>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {active ? (
                  <article className="card flex flex-col gap-3 p-5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-brand-700)] uppercase">
                        Recommended next step
                      </span>
                      <h3 className="truncate text-sm font-semibold">{active.tile.projectName}</h3>
                      <span className="truncate text-xs text-[var(--color-ink-subtle)]">
                        {active.tile.spaceName}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                      {active.nextAction.title} — {active.nextAction.body}
                    </p>

                    <div className="mt-auto flex flex-col gap-2">
                      {active.tile.conceptCount > 0 ? (
                        <>
                          <ProgressBar
                            value={active.tile.averageMastery}
                            label={`${active.tile.projectName} mastery`}
                            size="sm"
                          />
                          <span className="text-xs text-[var(--color-ink-subtle)]">
                            {Math.round(active.tile.averageMastery * 100)}% mastery ·{" "}
                            {active.tile.conceptCount} concepts
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-ink-subtle)]">
                          No concepts yet — add material to begin.
                        </span>
                      )}

                      <Link
                        href={`/spaces/${active.tile.spaceId}/projects/${active.tile.projectId}`}
                        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                      >
                        Continue
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    </div>
                  </article>
                ) : null}

                {otherProjects.map((tile) => (
                  <article key={tile.projectId} className="card flex flex-col gap-3 p-5">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="truncate text-sm font-semibold">{tile.projectName}</h3>
                      <span className="truncate text-xs text-[var(--color-ink-subtle)]">
                        {tile.spaceName}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                      {tile.goal}
                    </p>

                    <div className="mt-auto flex flex-col gap-2">
                      {tile.conceptCount > 0 ? (
                        <>
                          <ProgressBar
                            value={tile.averageMastery}
                            label={`${tile.projectName} mastery`}
                            size="sm"
                          />
                          <span className="text-xs text-[var(--color-ink-subtle)]">
                            {Math.round(tile.averageMastery * 100)}% mastery · {tile.conceptCount}{" "}
                            concepts
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-ink-subtle)]">
                          {tile.materialCount} material
                          {tile.materialCount === 1 ? "" : "s"} · no concepts yet
                        </span>
                      )}

                      <Link
                        href={`/spaces/${tile.spaceId}/projects/${tile.projectId}`}
                        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3.5 text-[13px] font-medium transition-colors hover:border-[var(--color-brand-300)] hover:bg-[var(--color-surface-muted)]"
                      >
                        Continue
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* Quick actions */}
          {quickActions.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-base font-semibold tracking-tight">Quick Actions</h2>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="card-interactive group flex items-center gap-3 p-4"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                    >
                      <action.icon className="size-4.5" />
                    </span>
                    <span className="truncate text-[13px] font-medium">{action.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
