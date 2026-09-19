import { AlertCircle, Bot } from "lucide-react";
import type { Citation } from "@/lib/learning/tutor";
import { cn } from "@/lib/utils";
import { CitationList } from "@/components/tutor/citation-list";

export type TutorMessageView = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations: Citation[];
  /** True for the explicit refusal the evidence gate produces. */
  insufficientEvidence?: boolean;
};

/**
 * One turn in the Tutor thread. Presentational and server-safe.
 *
 * The assistant turn carries an avatar rather than an in-bubble "Tutor" label, matching
 * the reference. The avatar is decorative, so the speaker is also announced in text for
 * anyone not looking at the shape of the bubble.
 */
export function TutorMessage({
  message,
  materialsHref,
  streaming = false,
}: {
  message: TutorMessageView;
  materialsHref: string;
  streaming?: boolean;
}) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-xl rounded-br-md bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 text-sm text-white shadow-xs">
          <p className="break-words whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const refusal = Boolean(message.insufficientEvidence);

  return (
    <div className="flex justify-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white"
      >
        <Bot className="size-4" />
      </span>

      <div
        /*
         * Announced as it arrives: the answer is the content of the interaction, and a
         * screen-reader user should not have to hunt for it after it appears.
         */
        aria-live={streaming ? "polite" : undefined}
        aria-busy={streaming || undefined}
        className={cn(
          "min-w-0 max-w-[92%] rounded-xl rounded-bl-md border px-4 py-3 text-sm shadow-xs",
          refusal
            ? "border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)]"
            : "border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)]/70",
        )}
      >
        <span className="sr-only">Tutor: </span>

        <p className="leading-6 break-words whitespace-pre-wrap text-[var(--color-ink)]">
          {message.content}
          {streaming ? (
            <span className="animate-pulse" aria-hidden="true">
              ▍
            </span>
          ) : null}
        </p>

        {refusal ? (
          <p className="mt-2.5 flex items-start gap-1.5 text-xs font-medium text-[var(--color-warning-ink)]">
            <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            No answer was generated — the materials did not support one.
          </p>
        ) : (
          <CitationList citations={message.citations} materialsHref={materialsHref} />
        )}
      </div>
    </div>
  );
}
