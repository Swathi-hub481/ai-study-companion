import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { listConversations } from "@/lib/services/tutor";
import { INSUFFICIENT_EVIDENCE_MESSAGE, type Citation } from "@/lib/learning/tutor";
import { isAppError } from "@/lib/errors";
import { TutorChat, type TutorConversation } from "@/components/tutor/tutor-chat";
import type { TutorMessageView } from "@/components/tutor/message";

type PageProps = { params: Promise<{ spaceId: string; projectId: string }> };

export const metadata: Metadata = { title: "Tutor" };

/**
 * The Tutor.
 *
 * Every conversation the Project has is already returned here, so the "Recent
 * Conversations" column is populated from data this page fetches anyway — selecting an
 * older thread swaps the visible messages without a request.
 */
export default async function TutorPage({ params }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const conversations = await listConversations(user.id, projectId);

  const threads: TutorConversation[] = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map(
      (message): TutorMessageView => ({
        id: message.id,
        role: message.role === "USER" ? "USER" : "ASSISTANT",
        content: message.content,
        citations: Array.isArray(message.citations) ? (message.citations as Citation[]) : [],
        insufficientEvidence:
          message.role === "ASSISTANT" && message.content === INSUFFICIENT_EVIDENCE_MESSAGE,
      }),
    ),
  }));

  const latest = threads[0] ?? null;
  const materialsHref = `/spaces/${dashboard.space.id}/projects/${projectId}/materials`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI Tutor</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Ask questions, get explanations with citations.
        </p>
      </header>

      <TutorChat
        projectId={projectId}
        conversations={threads}
        initialConversationId={latest?.id ?? null}
        initialMessages={latest?.messages ?? []}
        materialsHref={materialsHref}
      />
    </div>
  );
}
