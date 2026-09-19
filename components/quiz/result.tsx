import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnswerResultView, QuizOption } from "@/lib/learning/quiz";

/** How one answer was graded, and why. Feedback is always shown, not only the score. */
export function AnswerResult({
  answer,
  options,
}: {
  answer: AnswerResultView;
  options: QuizOption[];
}) {
  const correct = answer.isCorrect === true;
  const correctOption = options.find((option) => option.id === answer.correctAnswer);
  const Icon = correct ? CheckCircle2 : AlertTriangle;
  const colour = correct ? "var(--color-success-ink)" : "var(--color-warning-ink)";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 px-4 py-3",
          correct ? "bg-[var(--color-success-soft)]" : "bg-[var(--color-warning-soft)]",
        )}
      >
        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: colour }}
        >
          <Icon aria-hidden="true" className="size-4" />
          {correct ? "Correct" : "Not quite"}
        </span>
        <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
          {typeof answer.score === "number" ? `${Math.round(answer.score * 100)}%` : "ungraded"}
          {" · "}
          {answer.gradedBy === "deterministic" ? "graded by comparison" : "graded by rubric"}
        </span>
      </div>

      <div className="flex flex-col gap-3 bg-[var(--color-surface)] p-4">
        {answer.feedback ? (
          <p className="text-sm text-[var(--color-ink)]">{answer.feedback}</p>
        ) : null}

        {!correct && correctOption ? (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-3 py-2.5">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-subtle)] uppercase">
              Correct answer
            </span>
            <p className="mt-0.5 text-sm font-medium">{correctOption.text}</p>
          </div>
        ) : null}

        {answer.conceptsCovered.length > 0 || answer.conceptsMissing.length > 0 ? (
          <div className="flex flex-col gap-2">
            {answer.conceptsCovered.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                  Demonstrated
                </span>
                {answer.conceptsCovered.map((concept) => (
                  <Badge key={concept} variant="success">
                    {concept}
                  </Badge>
                ))}
              </div>
            ) : null}

            {answer.conceptsMissing.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-[var(--color-ink-muted)]">Missing</span>
                {answer.conceptsMissing.map((concept) => (
                  <Badge key={concept} variant="danger">
                    {concept}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
