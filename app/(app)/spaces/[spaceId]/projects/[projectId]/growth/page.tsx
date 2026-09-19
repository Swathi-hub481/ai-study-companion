import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lightbulb, ListChecks, TrendingUp } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { getProjectGrowth } from "@/lib/services/growth";
import { isAppError } from "@/lib/errors";
import { LearningPath } from "@/components/growth/learning-path";
import { ProgressRing } from "@/components/charts/progress-ring";
import { NextActionCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GROWTH_BAND_LABELS, GROWTH_BAND_ORDER, type GrowthBand } from "@/lib/learning/growth";

type PageProps = {
  params: Promise<{ spaceId: string; projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export const metadata: Metadata = { title: "Growth" };

const BAND_TONE: Record<GrowthBand, "danger" | "success" | "neutral"> = {
  NEEDS_ATTENTION: "danger",
  IMPROVING: "success",
  STABLE: "neutral",
};

/**
 * Growth.
 *
 * Three tabs, all fed by what this page already fetches: the mastery path (from the
 * growth evidence), the generated recommendations, and the single next action — the same
 * values the Project dashboard shows, so the two can never disagree.
 */
export default async function GrowthPage({ params, searchParams }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const { tab } = await searchParams;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const growth = await getProjectGrowth(user.id, projectId);

  // Weakest-first, so the path reads as the order to work through.
  const ordered = [...growth].sort(
    (a, b) => GROWTH_BAND_ORDER.indexOf(a.band) - GROWTH_BAND_ORDER.indexOf(b.band),
  );

  const openRecommendations = dashboard.recommendations.filter((entry) => entry.status === "OPEN");
  const active = tab === "recommendations" || tab === "next" ? tab : "growth";
  const base = `/spaces/${dashboard.space.id}/projects/${projectId}/growth`;

  const tabs = [
    { key: "growth", label: "Growth", href: base },
    { key: "recommendations", label: "Recommendations", href: `${base}?tab=recommendations` },
    { key: "next", label: "Next Steps", href: `${base}?tab=next` },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
        <p className="truncate text-sm text-[var(--color-ink-muted)]">{dashboard.project.name}</p>
      </header>

      <nav
        aria-label="Growth sections"
        className="flex items-center gap-6 overflow-x-auto border-b border-[var(--color-border-subtle)]"
      >
        {tabs.map((entry) => {
          const current = entry.key === active;

          return (
            <Link
              key={entry.key}
              href={entry.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2 text-sm font-medium whitespace-nowrap transition-colors",
                current
                  ? "border-[var(--color-brand-600)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ink-subtle)] hover:text-[var(--color-ink-muted)]",
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {active === "growth" ? (
        growth.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No concepts yet"
            body="Growth is computed from assessment evidence. Upload material to build this project's knowledge map, then take a quiz."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
            <section className="card flex flex-col items-center gap-4 p-5">
              <ProgressRing value={dashboard.mastery.average} label="Average mastery" />

              <div className="flex flex-col items-center gap-0.5 text-center">
                <p className="text-sm font-medium">Your Progress</p>
                <p className="text-xs text-[var(--color-ink-subtle)]">
                  Average mastery across {growth.length} concept{growth.length === 1 ? "" : "s"}
                </p>
              </div>

              <dl className="flex w-full flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
                {GROWTH_BAND_ORDER.map((band) => {
                  const count = growth.filter((concept) => concept.band === band).length;

                  return (
                    <div key={band} className="flex items-center justify-between gap-3">
                      <dt>
                        <Badge variant={BAND_TONE[band]}>{GROWTH_BAND_LABELS[band]}</Badge>
                      </dt>
                      <dd className="text-sm font-medium tabular-nums">{count}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>

            <LearningPath concepts={ordered} />
          </div>
        )
      ) : active === "recommendations" ? (
        <section className="card flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">Recommendations</h2>
            {openRecommendations.length > 0 ? (
              <Badge variant="brand">{openRecommendations.length} open</Badge>
            ) : null}
          </div>

          {openRecommendations.length === 0 ? (
            <EmptyState
              compact
              icon={Lightbulb}
              title="No open suggestions"
              body="Recommendations are generated from your results after you complete a quiz. Finish one and they will appear here."
            />
          ) : (
            <ul className="flex flex-col">
              {openRecommendations.map((recommendation) => (
                <li
                  key={recommendation.id}
                  className="flex flex-col gap-1.5 py-4 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border-subtle)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{recommendation.title}</h3>
                    {recommendation.conceptName ? (
                      <Badge variant="brand">{recommendation.conceptName}</Badge>
                    ) : null}
                    <span className="text-xs text-[var(--color-ink-subtle)] tabular-nums">
                      priority {recommendation.priority.toFixed(2)}
                    </span>
                  </div>

                  <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                    {recommendation.body}
                  </p>

                  <p className="text-xs text-[var(--color-ink-subtle)]">
                    {recommendation.reason ?? "No reason recorded."}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <NextActionCard action={dashboard.nextAction} title="Next step" />

          <div className="card flex flex-col gap-2 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListChecks aria-hidden="true" className="size-4 text-[var(--color-brand-500)]" />
              Where this comes from
            </p>
            <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
              {dashboard.nextAction.source === "recommendation"
                ? "A recommendation generated from your recent results, which supersedes the rule-based suggestion until it is resolved."
                : "The rule engine, based on your materials, assessment history and concept mastery — shown because there is no open recommendation."}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
