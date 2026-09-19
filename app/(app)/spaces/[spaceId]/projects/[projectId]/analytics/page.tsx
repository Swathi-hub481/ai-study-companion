import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Bot, ListChecks, Target } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { getProjectAnalytics } from "@/lib/services/analytics";
import { isAppError } from "@/lib/errors";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { ConceptRadar } from "@/components/charts/concept-radar";
import { ScoreTrend } from "@/components/charts/score-trend";
import { MasteryBar } from "@/components/mastery-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { cn, formatCount, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";

type PageProps = {
  params: Promise<{ spaceId: string; projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export const metadata: Metadata = { title: "Analytics" };

/**
 * Project analytics.
 *
 * Composition follows the reference — tabs, a wide chart beside a narrower list, then a
 * row of metric cards — but each panel holds a measure the analytics service actually
 * computes for this project. Nothing here is derived from a period-over-period
 * comparison, because the service does not produce one.
 */
export default async function ProjectAnalyticsPage({ params, searchParams }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const { tab } = await searchParams;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const analytics = await getProjectAnalytics(user.id, projectId);
  const { assessment, mastery, ai } = analytics;

  const active = tab === "assessment" || tab === "activity" ? tab : "progress";
  const base = `/spaces/${dashboard.space.id}/projects/${projectId}/analytics`;

  const tabs = [
    { key: "progress", label: "Learning Progress", href: base },
    { key: "assessment", label: "Quiz Performance", href: `${base}?tab=assessment` },
    { key: "activity", label: "Activity", href: `${base}?tab=activity` },
  ] as const;

  // The service returns most-recent-first; a trend reads left to right.
  const scorePoints = [...assessment.recentScores].reverse();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="truncate text-sm text-[var(--color-ink-muted)]">
          {dashboard.project.name} · last {analytics.windowDays} days
        </p>
      </header>

      <nav
        aria-label="Analytics sections"
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

      {active === "progress" ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
            <section className="card flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">Assessment progress</h2>
                <Badge variant="neutral">{scorePoints.length} graded</Badge>
              </div>

              <ScoreTrend points={scorePoints} label="Assessment progress" />

              <p className="text-xs leading-5 text-[var(--color-ink-subtle)]">
                Every graded answer in this window, oldest first. Mastery is what the quiz engine
                reads; this is the raw score history behind it.
              </p>
            </section>

            <section className="card flex flex-col gap-4 p-5">
              <h2 className="text-base font-semibold tracking-tight">Concept mastery</h2>

              {mastery.concepts.length === 0 ? (
                <EmptyState
                  compact
                  icon={Target}
                  title="No concepts yet"
                  body="Mastery appears once a document has been processed and its concepts extracted."
                />
              ) : (
                <ul className="flex flex-col gap-3.5">
                  {mastery.concepts.slice(0, 8).map((concept) => (
                    <li key={concept.id}>
                      <MasteryBar value={concept.mastery} label={concept.name} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section aria-label="Key measures" className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Activity"
              value={analytics.activityTotal}
              hint={`events in ${analytics.windowDays} days`}
              icon={Activity}
              tone="brand"
            />
            <StatCard
              label="Questions answered"
              value={assessment.answersGraded}
              hint={`${assessment.quizzesCompleted} quizzes completed`}
              icon={ListChecks}
              tone="accent"
            />
            <StatCard
              label="Average score"
              value={
                assessment.averageScore === null ? "—" : formatPercent(assessment.averageScore)
              }
              hint={`${assessment.quizzesStarted} quizzes started`}
              icon={Target}
              tone="success"
            />
          </section>
        </>
      ) : active === "assessment" ? (
        <>
          <section aria-label="Assessment totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Quizzes started" value={assessment.quizzesStarted} icon={ListChecks} />
            <StatCard
              label="Quizzes completed"
              value={assessment.quizzesCompleted}
              tone="success"
              icon={ListChecks}
            />
            <StatCard label="Answers graded" value={assessment.answersGraded} icon={Target} />
            <StatCard
              label="Average score"
              value={
                assessment.averageScore === null ? "—" : formatPercent(assessment.averageScore)
              }
              tone="brand"
              icon={Target}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
            <section className="card flex flex-col gap-4 p-5">
              <h2 className="text-base font-semibold tracking-tight">Mastery shape</h2>

              {mastery.concepts.length === 0 ? (
                <EmptyState
                  compact
                  icon={Target}
                  title="No concepts yet"
                  body="Mastery appears once a document has been processed."
                />
              ) : (
                <>
                  <ConceptRadar
                    concepts={mastery.concepts.map((concept) => ({
                      name: concept.name,
                      mastery: concept.mastery,
                    }))}
                  />
                  <p className="text-xs leading-5 text-[var(--color-ink-subtle)]">
                    A spiky outline means strong in places and weak in others; a small even one
                    means the whole topic needs work.
                  </p>
                </>
              )}
            </section>

            <section className="card flex flex-col gap-4 p-5">
              <h2 className="text-base font-semibold tracking-tight">Recent answers</h2>

              {assessment.recentScores.length === 0 ? (
                <EmptyState
                  compact
                  icon={ListChecks}
                  title="No graded answers yet"
                  body="Scores appear here once you answer quiz questions."
                />
              ) : (
                <ul className="flex flex-col">
                  {assessment.recentScores.slice(0, 10).map((entry, index) => {
                    const colour =
                      entry.score >= 0.6 ? "var(--color-mastery-high)" : "var(--color-mastery-low)";

                    return (
                      <li
                        key={`${entry.at}-${index}`}
                        className="flex items-center justify-between gap-4 py-2.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border-subtle)]"
                      >
                        <span className="text-sm text-[var(--color-ink-muted)]">
                          {formatRelativeTime(entry.at)}
                        </span>
                        <span className="flex items-center gap-3">
                          <ProgressBar
                            value={entry.score}
                            label={`${formatPercent(entry.score)} score`}
                            size="sm"
                            colour={colour}
                            className="hidden w-24 sm:block"
                          />
                          <span
                            className="w-12 text-right text-sm tabular-nums"
                            style={{ color: colour }}
                          >
                            {formatPercent(entry.score)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-base font-semibold tracking-tight">
              Daily activity (last {analytics.windowDays} days)
            </h2>

            <ActivityHeatmap buckets={analytics.activity} />

            {analytics.activityByType.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {analytics.activityByType.slice(0, 8).map((entry) => (
                  <li key={entry.type}>
                    <Badge variant="neutral" className="tabular-nums">
                      {entry.type.toLowerCase().replace(/_/g, " ")} · {entry.count}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">AI activity</h2>
              <Badge variant={ai.failures > 0 ? "warning" : "neutral"}>
                {formatCount(ai.calls)} calls · {ai.failures} failed
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Prompt tokens", value: formatCount(ai.promptTokens) },
                { label: "Completion tokens", value: formatCount(ai.completionTokens) },
                { label: "Average latency", value: `${ai.averageLatencyMs}ms` },
                { label: "Estimated cost", value: formatUsd(ai.costUsd) },
              ].map((entry) => (
                <div
                  key={entry.label}
                  className="flex flex-col gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-3 py-2.5"
                >
                  <dt className="text-[11px] tracking-wide text-[var(--color-ink-subtle)] uppercase">
                    {entry.label}
                  </dt>
                  <dd className="text-sm font-medium tabular-nums">{entry.value}</dd>
                </div>
              ))}
            </dl>

            {ai.byFeature.length > 0 ? (
              <ul className="flex flex-col">
                {ai.byFeature.map((entry) => (
                  <li
                    key={entry.feature}
                    className="flex items-center justify-between gap-4 py-2 text-sm [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border-subtle)]"
                  >
                    <span className="flex items-center gap-2">
                      <Bot aria-hidden="true" className="size-3.5 text-[var(--color-ink-subtle)]" />
                      {entry.feature.toLowerCase().replace(/_/g, " ")}
                    </span>
                    <span className="text-[var(--color-ink-subtle)] tabular-nums">
                      {entry.calls} calls
                      {entry.failures > 0 ? ` · ${entry.failures} failed` : ""} ·{" "}
                      {entry.averageLatencyMs}ms
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Bot}
                title="No model calls in this window"
                body="Tutor answers, quiz generation and grading appear here as you use them."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
