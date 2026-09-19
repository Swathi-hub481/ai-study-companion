import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardList, ListChecks } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { listQuizzes } from "@/lib/services/quizzes";
import { isAppError } from "@/lib/errors";
import { StartQuizForm } from "@/components/quiz/start-quiz-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";

type PageProps = {
  params: Promise<{ spaceId: string; projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export const metadata: Metadata = { title: "Quizzes" };

/**
 * Quizzes.
 *
 * Two tabs, both fed by data this page already fetches: the generator's settings, and
 * the attempts already taken. The tab lives in the URL as a plain link so the screen
 * stays a server component — the same pattern the admin views use.
 */
export default async function QuizPage({ params, searchParams }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const { tab } = await searchParams;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const quizzes = await listQuizzes(user.id, projectId);

  const hasConcepts = dashboard.counts.concepts > 0;
  const active = tab === "attempts" ? "attempts" : "available";
  const base = `/spaces/${dashboard.space.id}/projects/${projectId}/quiz`;

  const tabs = [
    { key: "available", label: "Available Quizzes", href: base },
    { key: "attempts", label: "My Attempts", href: `${base}?tab=attempts` },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Quizzes</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">{dashboard.project.name}</p>
      </header>

      <nav aria-label="Quiz sections" className="flex items-center gap-6 border-b border-[var(--color-border-subtle)]">
        {tabs.map((entry) => {
          const current = entry.key === active;

          return (
            <Link
              key={entry.key}
              href={entry.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
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

      {active === "available" ? (
        hasConcepts ? (
          <StartQuizForm projectId={projectId} spaceId={dashboard.space.id} />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Nothing to assess yet"
            body="Quizzes are generated from the concepts in your material. Upload and process a document first, then come back."
          />
        )
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No attempts yet"
          body="Once you generate and finish a quiz it appears here, with its score and when you took it."
        />
      ) : (
        <ul className="card flex flex-col p-2">
          {quizzes.map((quiz) => {
            const title = quiz.title ?? "Quiz";
            const initial = (title.match(/[a-z0-9]/i)?.[0] ?? "Q").toUpperCase();

            return (
              <li key={quiz.id}>
                <Link
                  href={`${base}/${quiz.id}`}
                  className="group flex items-center gap-3.5 rounded-lg px-3 py-3 transition-colors hover:bg-[var(--color-surface-muted)]/50"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-sm font-semibold text-[var(--color-brand-700)]"
                  >
                    {initial}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="min-w-0 truncate text-sm font-medium transition-colors group-hover:text-[var(--color-brand-600)]">
                      {title}
                    </span>
                    <span className="text-xs text-[var(--color-ink-subtle)] tabular-nums">
                      {quiz.questionCount} {quiz.questionCount === 1 ? "question" : "questions"} ·{" "}
                      {quiz.mode === "QUIZ" ? "MCQ" : "Open-ended"} ·{" "}
                      {formatRelativeTime(quiz.startedAt)}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-xs text-[var(--color-ink-subtle)] tabular-nums sm:inline">
                      {quiz.answeredCount}/{quiz.questionCount} answered
                      {quiz.averageScore !== null
                        ? ` · ${Math.round(quiz.averageScore * 100)}%`
                        : ""}
                    </span>

                    <Badge variant={quiz.status === "COMPLETED" ? "success" : "warning"}>
                      {quiz.status === "COMPLETED" ? "Completed" : "In progress"}
                    </Badge>

                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 text-[var(--color-ink-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)]"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
