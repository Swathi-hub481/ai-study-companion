"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, SendHorizonal, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TutorMessage, type TutorMessageView } from "@/components/tutor/message";
import { readSseStream } from "@/lib/sse-client";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Citation } from "@/lib/learning/tutor";

/**
 * How long a stream may go without emitting anything before it is abandoned.
 *
 * A stalled stream leaves a half-written bubble on screen forever; an error the learner
 * can retry is strictly better than a spinner that never ends.
 */
const STREAM_IDLE_TIMEOUT_MS = 30_000;

export type TutorConversation = {
  id: string;
  title: string;
  updatedAt: string;
  messages: TutorMessageView[];
};

/**
 * Streaming Tutor chat.
 *
 * The answer arrives over SSE, so the request is a `fetch` whose body is read
 * incrementally rather than a JSON call. A draft assistant message is appended
 * immediately and patched as events arrive; the id is only reconciled with the
 * server's once the turn is persisted.
 *
 * Layout follows the reference: a "Recent Conversations" column beside the thread. Every
 * conversation and its messages are already fetched by the page, so switching between
 * them is local state — no request, no endpoint and no extra query.
 */
export function TutorChat({
  projectId,
  conversations,
  initialConversationId,
  initialMessages,
  materialsHref,
}: {
  projectId: string;
  conversations: TutorConversation[];
  initialConversationId: string | null;
  initialMessages: TutorMessageView[];
  materialsHref: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The last question that failed, so it can be retried without retyping it. */
  const [retryable, setRetryable] = useState<string | null>(null);

  /**
   * Mirrors `conversationId` so the re-sync effect can compare against it without
   * taking a dependency on state it deliberately does not want to react to.
   */
  const conversationIdRef = useRef<string | null>(initialConversationId);

  const endRef = useRef<HTMLDivElement>(null);

  function setThread(id: string | null) {
    conversationIdRef.current = id;
    setConversationId(id);
  }

  /*
   * Re-sync when the server sends fresh props (after router.refresh()).
   *
   * Only when the server's thread is still the one on screen: if the learner has opened
   * an older conversation, the newest thread's messages must not overwrite it.
   */
  useEffect(() => {
    if (conversationIdRef.current !== initialConversationId) return;
    setMessages(initialMessages);
  }, [initialMessages, initialConversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function openConversation(conversation: TutorConversation) {
    if (pending) return;

    setThread(conversation.id);
    setMessages(conversation.messages);
    setError(null);
    setRetryable(null);
  }

  async function send(question: string, options: { appendUserMessage?: boolean } = {}) {
    const appendUserMessage = options.appendUserMessage ?? true;
    const draftId = `draft-${Date.now()}`;

    setError(null);
    setRetryable(null);
    setInput("");
    setPending(true);

    setMessages((current) => [
      // On a retry the question is already in the transcript; adding it again would
      // duplicate it.
      ...current,
      ...(appendUserMessage
        ? [{ id: `local-${draftId}`, role: "USER" as const, content: question, citations: [] }]
        : []),
      { id: draftId, role: "ASSISTANT" as const, content: "", citations: [] },
    ]);

    const patchDraft = (patch: (message: TutorMessageView) => TutorMessageView) =>
      setMessages((current) => current.map((m) => (m.id === draftId ? patch(m) : m)));

    const dropDraft = () => setMessages((current) => current.filter((m) => m.id !== draftId));

    const controller = new AbortController();
    let stalled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          conversationId: conversationIdRef.current ?? undefined,
          message: question,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        setError(payload?.error?.message ?? "Something went wrong. Please try again.");
        setRetryable(question);
        dropDraft();
        return;
      }

      if (!response.body) {
        setError("The server did not return a stream.");
        setRetryable(question);
        dropDraft();
        return;
      }

      armIdleTimer();

      for await (const event of readSseStream(response.body)) {
        armIdleTimer();

        const data = JSON.parse(event.data) as Record<string, unknown>;

        switch (event.event) {
          case "citations":
            setThread(String(data.conversationId));
            patchDraft((message) => ({ ...message, citations: data.citations as Citation[] }));
            break;

          case "delta":
            patchDraft((message) => ({ ...message, content: message.content + String(data.text) }));
            break;

          case "insufficient_evidence":
            setThread(String(data.conversationId));
            patchDraft((message) => ({
              ...message,
              id: String(data.messageId),
              content: String(data.message),
              insufficientEvidence: true,
            }));
            break;

          case "done":
            setThread(String(data.conversationId));
            patchDraft((message) => ({ ...message, id: String(data.messageId) }));
            break;

          case "error":
            setError(String(data.message));
            setRetryable(question);
            break;
        }
      }
    } catch {
      setError(
        stalled
          ? "That answer stalled. Please try again."
          : "The connection to the Tutor was interrupted. Please try again.",
      );
      setRetryable(question);
      dropDraft();
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      setPending(false);
      router.refresh();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    void send(question);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const question = input.trim();
      if (question && !pending) void send(question);
    }
  }

  function handleNewConversation() {
    if (pending) return;
    setThread(null);
    setMessages([]);
    setError(null);
    setRetryable(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
      {/* Conversation history */}
      <aside className="card hidden flex-col gap-2 p-3 lg:flex">
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <h2 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--color-ink-subtle)] uppercase">
            Recent Conversations
          </h2>

          <button
            type="button"
            onClick={handleNewConversation}
            disabled={pending}
            aria-label="New conversation"
            className="flex size-6 items-center justify-center rounded-md text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            <SquarePen aria-hidden="true" className="size-3.5" />
          </button>
        </div>

        {conversations.length === 0 ? (
          <p className="px-1 pb-1 text-xs leading-5 text-[var(--color-ink-subtle)]">
            No conversations yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {conversations.map((conversation) => {
              const active = conversation.id === conversationId;

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(conversation)}
                    disabled={pending}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-50",
                      active
                        ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                        : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]/70 hover:text-[var(--color-ink)]",
                    )}
                  >
                    <span className="truncate text-[13px] font-medium">{conversation.title}</span>
                    <span className="text-[11px] text-[var(--color-ink-subtle)]">
                      {formatRelativeTime(conversation.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Thread */}
      <section className="card flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 lg:hidden">
          <span className="text-[13px] font-medium">Conversation</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewConversation}
            disabled={pending || messages.length === 0}
          >
            <SquarePen aria-hidden="true" className="size-3.5" />
            New
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-5">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No questions yet"
              body="Ask anything this project's materials cover. Answers are grounded in your uploaded documents, and cite the pages they came from. Questions the materials cannot support are refused rather than guessed at."
            />
          ) : (
            <div className="flex flex-col gap-4 lg:max-h-[34rem] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
              <ol className="flex flex-col gap-4">
                {messages.map((message) => (
                  <li key={message.id}>
                    <TutorMessage
                      message={message}
                      materialsHref={materialsHref}
                      streaming={pending && message.id.startsWith("draft-")}
                    />
                  </li>
                ))}
              </ol>

              {/* Scroll target: kept at the end of the transcript so the newest turn lands in view. */}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/*
          The composer is pinned on phones as well as desktop: the reference puts the
          input at the bottom of the mobile Tutor, and without this it would sit at the end
          of a long transcript. It clears the fixed bottom bar (`bottom-16`), and the
          background plus bottom radius keep it reading as part of the card while it
          floats over the messages.
        */}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3 rounded-b-[var(--radius-card)] border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-4 sm:px-5 lg:bottom-0">
          {error ? (
            <div className="flex flex-wrap items-center gap-3">
              <Alert tone="danger" role="alert" className="min-w-0 flex-1">
                {error}
              </Alert>

              {retryable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void send(retryable, { appendUserMessage: false })}
                  disabled={pending}
                >
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field
              label="Your question"
              htmlFor="tutor-question"
              hint="Enter to send · Shift+Enter for a new line."
            >
              <Textarea
                id="tutor-question"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                maxLength={4000}
                disabled={pending}
                aria-describedby="tutor-question-hint"
                placeholder="Type your message..."
                className="min-h-[4.5rem]"
              />
            </Field>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[var(--color-ink-subtle)]">
                Answers are generated only from this project&apos;s materials.
              </p>

              <Button
                type="submit"
                size="lg"
                disabled={pending || input.trim().length === 0}
                className="w-full sm:w-auto"
              >
                <SendHorizonal aria-hidden="true" className="size-4" />
                {pending ? "Answering…" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
