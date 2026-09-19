import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Activity, ListChecks, Sparkles, TrendingUp } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { getUserJourney } from "@/lib/services/admin";
import { isAppError } from "@/lib/errors";
import { AdminNav } from "@/components/admin/admin-nav";
import { MasteryBar } from "@/components/mastery-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import { activityLabel } from "@/lib/analytics/activity-types";
import { cn, formatCount, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";

type PageProps = { params: Promise<{ userId: string }> };

export const metadata: Metadata = { title: "Admin · User journey" };

/**
 * One user, traced end to end.
 *
 * This page is the phase's acceptance criterion made visible: activity → assessment →
 * mastery → AI usage, in that order, for a single account.
 */
export default async function AdminUserJourneyPage({ params }: PageProps) {
  const admin = await requireAdminPage();
  const { userId } = await params;

  const journey = await getUserJourney(admin, userId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const { user, activity, assessments, mastery, ai } = journey;

  const anchors = [
    { id: "activity", label: "Activity" },
    { id: "assessment", label: "Assessment" },
    { id: "mastery", label: "Mastery" },
    { id: "ai-usage", label: "AI usage" },
    ...(journey.projects.length > 0 ? [{ id: "projects", label: "Projects" }] : []),
  ];

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Users", href: "/admin/users" },
          { label: user.name },
        ]}
        title={user.name}
        description={`${user.email} · ${user.role.toLowerCase()} · joined ${formatRelativeTime(user.createdAt)}`}
      />

      <AdminNav />

      <nav aria-label="Journey sections" className="flex flex-wrap gap-2 text-[13px]">
        {anchors.map((anchor) => (
          <a
            key={anchor.id}
            href={`#${anchor.id}`}
            className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 font-medium text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-600)]"
          >
            {anchor.label}
          </a>
        ))}
      </nav>

      <section aria-label="Journey summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Activity events"
          value={formatCount(activity.total)}
          hint="all time"
          icon={Activity}
        />
        <StatCard
          label="Assessments"
          value={assessments.answersGraded}
          hint={`${assessments.quizzesCompleted} quizzes completed`}
          icon={ListChecks}
        />
        <StatCard
          label="Average mastery"
          value={formatPercent(mastery.average)}
          hint={`${mastery.concepts.length} concepts tracked`}
          icon={TrendingUp}
        />
        <StatCard
          label="AI calls"
          value={formatCount(ai.calls)}
          hint={`${ai.failures} failed · ${formatUsd(ai.costUsd)}`}
          icon={Sparkles}
          tone={ai.failures > 0 ? "warning" : "neutral"}
        />
      </section>

      {/* 1. Activity */}
      <Section id="activity" title="Activity" className="scroll-mt-24">
        {activity.recent.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-subtle)]">No activity recorded.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {activity.byType.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {activity.byType.slice(0, 10).map((entry) => (
                  <li
                    key={entry.type}
                    className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]"
                  >
                    {activityLabel(entry.type).toLowerCase()} ·{" "}
                    <span className="tabular-nums">{entry.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <ol className="flex flex-col">
              {activity.recent.map((event, index) => (
                <li
                  key={event.id}
                  className={cn(
                    "flex items-center justify-between gap-4 py-2 text-sm",
                    index > 0 && "border-t border-[var(--color-border-subtle)]",
                  )}
                >
                  <span>{activityLabel(event.type)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-subtle)]">
                    {formatRelativeTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* 2. Assessment */}
      <Section id="assessment" title="Assessment" className="scroll-mt-24">
        {assessments.answersGraded === 0 ? (
          <p className="text-sm text-[var(--color-ink-subtle)]">No answers graded yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-ink-muted)]">
              {assessments.quizzesStarted} quizzes started,{" "}
              <span className="tabular-nums">{assessments.quizzesCompleted}</span> completed ·{" "}
              <span className="tabular-nums">{assessments.answersGraded}</span> answers graded
              {assessments.averageScore !== null ? (
                <>
                  {" "}
                  · <span className="tabular-nums">
                    {formatPercent(assessments.averageScore)}
                  </span>{" "}
                  average
                </>
              ) : null}
            </p>

            <ul className="flex flex-col">
              {assessments.recent.map((answer, index) => (
                <li
                  key={`${answer.at}-${index}`}
                  className={cn(
                    "flex items-center justify-between gap-4 py-2 text-sm",
                    index > 0 && "border-t border-[var(--color-border-subtle)]",
                  )}
                >
                  <span className="truncate">{answer.quizTitle ?? "Quiz"}</span>
                  <span className="shrink-0 tabular-nums">
                    {answer.score === null ? "ungraded" : formatPercent(answer.score)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 3. Mastery */}
      <Section id="mastery" title="Mastery" className="scroll-mt-24">
        {mastery.concepts.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No concepts yet"
            body="This user has no extracted concepts, so there is nothing to measure mastery against."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {mastery.concepts.map((concept) => (
              <li key={`${concept.projectName}-${concept.name}`}>
                <MasteryBar
                  value={concept.mastery}
                  label={`${concept.name} · ${concept.projectName}`}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4. AI usage */}
      <Section id="ai-usage" title="AI usage" className="scroll-mt-24">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-ink-muted)] tabular-nums">
            {formatCount(ai.calls)} calls · {formatCount(ai.promptTokens)} prompt tokens ·{" "}
            {formatCount(ai.completionTokens)} completion tokens · {ai.averageLatencyMs}ms average ·{" "}
            {formatUsd(ai.costUsd)}
          </p>

          {ai.byFeature.length > 0 ? (
            <ul className="flex flex-col">
              {ai.byFeature.map((entry, index) => (
                <li
                  key={entry.feature}
                  className={cn(
                    "flex items-center justify-between gap-4 py-2 text-sm",
                    index > 0 && "border-t border-[var(--color-border-subtle)]",
                  )}
                >
                  <span>{entry.feature.toLowerCase().replace(/_/g, " ")}</span>
                  <span className="text-[var(--color-ink-subtle)] tabular-nums">
                    {entry.calls} calls{entry.failures > 0 ? ` · ${entry.failures} failed` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      {journey.projects.length > 0 ? (
        <Section id="projects" title="Projects" className="scroll-mt-24">
          <ul className="flex flex-col">
            {journey.projects.map((project, index) => (
              <li
                key={project.id}
                className={cn(
                  "flex items-center justify-between gap-4 py-2 text-sm",
                  index > 0 && "border-t border-[var(--color-border-subtle)]",
                )}
              >
                <span>{project.name}</span>
                <span className="text-xs text-[var(--color-ink-subtle)]">{project.spaceName}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
