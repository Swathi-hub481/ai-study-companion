import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Target,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { isAppError } from "@/lib/errors";
import { ActivityFeed } from "@/components/activity-feed";
import { NextActionCard } from "@/components/projects/project-card";
import { RefreshRecommendationsButton } from "@/components/projects/refresh-recommendations-button";
import { MasteryBar } from "@/components/mastery-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";

type PageProps = { params: Promise<{ spaceId: string; projectId: string }> };

async function loadDashboard(userId: string, projectId: string) {
  return getProjectDashboard(userId, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectId } = await params;
  const user = await requireUserPage();

  try {
    const dashboard = await loadDashboard(user.id, projectId);
    return { title: dashboard.project.name };
  } catch {
    return { title: "Project" };
  }
}

/** The learning loop for a project, in the order it is meant to be walked. */
const DESTINATIONS: Array<{
  label: string;
  description: string;
  segment: string;
  icon: LucideIcon;
}> = [
  {
    label: "Materials",
    description: "Upload and process source documents",
    segment: "materials",
    icon: FileText,
  },
  {
    label: "Tutor",
    description: "Grounded answers with citations",
    segment: "tutor",
    icon: MessageSquare,
  },
  { label: "Quiz", description: "Adaptive assessment", segment: "quiz", icon: ListChecks },
  {
    label: "Growth",
    description: "How your concepts are changing",
    segment: "growth",
    icon: TrendingUp,
  },
  {
    label: "Analytics",
    description: "Activity and performance trends",
    segment: "analytics",
    icon: BarChart3,
  },
];

export default async function ProjectPage({ params }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;

  const dashboard = await loadDashboard(user.id, projectId);
  const { project, space, counts, mastery, performance, activity, nextAction, recommendations } =
    dashboard;

  const hasConcepts = mastery.concepts.length > 0;
  const openRecommendations = recommendations.filter((entry) => entry.status === "OPEN");
  const base = `/spaces/${space.id}/projects/${project.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={project.description}
        breadcrumbs={[
          { label: "Spaces", href: "/spaces" },
          { label: space.name, href: `/spaces/${space.id}` },
          { label: project.name },
        ]}
      />

      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-xs">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"
        >
          <Target className="size-4" />
        </span>

        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)] uppercase">
            Learning goal
          </h2>
          <p className="text-sm leading-6 text-[var(--color-ink)]">{project.goal}</p>
        </div>
      </div>

      <NextActionCard action={nextAction} />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Materials"
          value={counts.materials}
          hint={`${counts.readyMaterials} ready${
            counts.failedMaterials > 0 ? `, ${counts.failedMaterials} failed` : ""
          }`}
          tone={counts.failedMaterials > 0 ? "warning" : "neutral"}
        />
        <StatCard label="Concepts" value={counts.concepts} hint="Tracked in this project" />
        <StatCard
          label="Average mastery"
          value={`${Math.round(mastery.average * 100)}%`}
          hint="Estimated, not measured"
        />
        <StatCard
          label="Tutor threads"
          value={counts.conversations}
          hint={
            performance.quizzesCompleted > 0
              ? `${performance.quizzesCompleted} quizzes completed`
              : "No quizzes yet"
          }
        />
      </section>

      <Section
        title="Continue into"
        description="The learning loop for this project, in order."
        bodyClassName="grid grid-cols-2 gap-3 lg:grid-cols-5"
      >
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.label}
            href={`${base}/${destination.segment}`}
            className="card-interactive group flex h-full flex-col gap-2 p-4"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-muted)] text-[var(--color-brand-600)] transition-colors group-hover:bg-[var(--color-brand-50)]"
            >
              <destination.icon className="size-4" />
            </span>

            <span className="text-sm font-medium">{destination.label}</span>
            <span className="text-xs leading-4 text-[var(--color-ink-subtle)]">
              {destination.description}
            </span>

            <ArrowRight
              aria-hidden="true"
              className="mt-auto size-3.5 text-[var(--color-ink-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)]"
            />
          </Link>
        ))}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Section
            title="Concept mastery"
            description="Estimated from your graded answers and Tutor interactions."
          >
            {hasConcepts ? (
              <ul className="flex flex-col gap-4">
                {mastery.concepts.map((concept) => (
                  <li key={concept.id}>
                    <MasteryBar value={concept.mastery} label={concept.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Lightbulb}
                title="No concepts yet"
                body="Concepts are extracted when your material finishes processing. Add a document to build the knowledge map for this project."
              >
                <Link
                  href={`${base}/materials`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-brand-700)]"
                >
                  <FileText aria-hidden="true" className="size-3.5" />
                  Upload material
                </Link>
              </EmptyState>
            )}
          </Section>

          <Section
            title="Learning performance"
            description="Graded answers across every quiz in this project."
          >
            {performance.answersGraded > 0 ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <p className="text-3xl leading-none font-semibold tabular-nums">
                  {Math.round((performance.averageScore ?? 0) * 100)}%
                </p>
                <p className="text-sm text-[var(--color-ink-muted)]">
                  {performance.answersGraded} answers graded across {performance.quizzesCompleted}{" "}
                  completed {performance.quizzesCompleted === 1 ? "quiz" : "quizzes"}
                </p>
              </div>
            ) : (
              <EmptyState
                compact
                icon={ListChecks}
                title="No assessments yet"
                body="Adaptive quizzes measure your understanding and feed concept mastery. They are generated from your own materials, so they arrive once documents are processed."
              />
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section
            title="Recommendations"
            description="Suggested next actions, each with the reason it was produced."
            action={<RefreshRecommendationsButton projectId={projectId} />}
          >
            {openRecommendations.length === 0 ? (
              <p className="text-[13px] leading-5 text-[var(--color-ink-subtle)]">
                No open suggestions. They are generated after you complete a quiz, or you can ask
                for a fresh set with the button above.
              </p>
            ) : (
              <ul className="flex flex-col">
                {openRecommendations.map((recommendation, index) => (
                  <li
                    key={recommendation.id}
                    className={`flex flex-col gap-1.5 py-3 ${
                      index > 0 ? "border-t border-[var(--color-border-subtle)]" : "pt-0"
                    }`}
                  >
                    <span className="text-sm font-medium">{recommendation.title}</span>
                    <span className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                      {recommendation.body}
                    </span>
                    <span className="text-xs text-[var(--color-ink-subtle)]">
                      {recommendation.conceptName ? (
                        <span className="font-medium text-[var(--color-ink-muted)]">
                          {recommendation.conceptName}
                        </span>
                      ) : null}
                      {recommendation.conceptName ? " · " : ""}
                      {recommendation.reason ?? "No reason recorded."}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent activity" description="What has happened in this project.">
            <ActivityFeed items={activity} emptyMessage="No activity in this project yet." />
          </Section>
        </div>
      </div>
    </div>
  );
}
