import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { getQuiz } from "@/lib/services/quizzes";
import { isAppError } from "@/lib/errors";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { Breadcrumbs } from "@/components/ui/page-header";

type PageProps = { params: Promise<{ spaceId: string; projectId: string; quizId: string }> };

export const metadata: Metadata = { title: "Quiz" };

export default async function QuizRunPage({ params }: PageProps) {
  const user = await requireUserPage();
  const { projectId, quizId } = await params;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const quiz = await getQuiz(user.id, quizId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Spaces", href: "/spaces" },
          { label: dashboard.space.name, href: `/spaces/${dashboard.space.id}` },
          {
            label: dashboard.project.name,
            href: `/spaces/${dashboard.space.id}/projects/${projectId}`,
          },
          {
            label: "Quiz",
            href: `/spaces/${dashboard.space.id}/projects/${projectId}/quiz`,
          },
          { label: quiz.title ?? "Attempt" },
        ]}
      />

      <QuizRunner initialQuiz={quiz} />
    </div>
  );
}
