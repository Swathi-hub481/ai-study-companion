import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import type { QuizQuestionView } from "@/lib/learning/quiz";

/**
 * A question's frame: type, concept, and difficulty.
 *
 * The interactive part is passed in as children, so this stays presentational and the
 * same frame is used whether the question is unanswered or already graded. The position
 * ("Question 3 of 6") belongs to the runner, not here, so it is stated once.
 */
export function QuestionCard({
  question,
  children,
}: {
  question: QuizQuestionView;
  children: React.ReactNode;
}) {
  const typeLabel = question.type === "MULTIPLE_CHOICE" ? "Multiple choice" : "Open-ended";
  const difficulty = Math.round(question.difficulty * 100);

  return (
    <div className="card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-brand-700)] uppercase">
          {typeLabel}
        </span>

        <span className="flex flex-wrap items-center gap-2">
          {question.conceptName ? <Badge variant="brand">{question.conceptName}</Badge> : null}

          <span className="flex items-center gap-1.5">
            <ProgressBar
              value={question.difficulty}
              label={`Difficulty ${difficulty}%`}
              size="sm"
              className="w-12"
            />
            <span className="text-[11px] text-[var(--color-ink-subtle)] tabular-nums">
              Difficulty {difficulty}%
            </span>
          </span>
        </span>
      </div>

      <p className="text-base leading-7 font-medium whitespace-pre-wrap">{question.prompt}</p>

      {children}
    </div>
  );
}
