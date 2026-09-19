"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/**
 * Free-text answer entry.
 *
 * A textarea plus an explicit submit, because an open-ended answer is graded by a model
 * call — submitting on every keystroke or on blur would be both expensive and unhelpful.
 */
export function OpenEnded({
  value,
  onChange,
  onSubmit,
  pending,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        aria-label="Your answer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter submits; Shift+Enter starts a new line.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (value.trim() && !pending) onSubmit();
          }
        }}
        rows={5}
        maxLength={4000}
        disabled={pending}
        placeholder="Explain in your own words…"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[var(--color-ink-subtle)]">
          Graded against this project&apos;s materials —{" "}
          <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to submit,{" "}
          <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-1 py-0.5 font-mono text-[10px]">
            Shift
          </kbd>
          +
          <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          for a new line.
        </p>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-xs tabular-nums text-[var(--color-ink-subtle)]">
            {value.length}/4000
          </span>
          <Button
            onClick={onSubmit}
            disabled={pending || value.trim().length === 0}
            className="w-full sm:w-auto"
            aria-busy={pending}
          >
            {pending ? "Grading…" : "Submit answer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
