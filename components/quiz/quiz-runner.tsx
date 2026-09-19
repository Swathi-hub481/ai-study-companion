"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProgressBar, ProgressValue } from "@/components/ui/progress";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { QuestionCard } from "@/components/quiz/question-card";
import { OpenEnded } from "@/components/quiz/open-ended";
import { AnswerResult } from "@/components/quiz/result";
import type { AnswerResultView, QuizView } from "@/lib/learning/quiz";

/**
 * Runs a quiz: one question at a time, graded on submit.
 *
 * Answering is immutable — the server rejects a second answer to the same question — so
 * an answered question is replaced in place with its result rather than staying editable.
 *
 * The stepper is presentation only: every answer still goes through the same endpoint in
 * the same way, and the whole paper stays in memory, so moving between questions never
 * re-fetches anything.
 */
export function QuizRunner({ initialQuiz }: { initialQuiz: QuizView }) {
  const router = useRouter();
  const [quiz, setQuiz] = useState(initialQuiz);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masteryNote, setMasteryNote] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const answered = quiz.questions.filter((question) => question.answer).length;
  const total = quiz.questions.length;
  const allAnswered = total > 0 && answered === total;
  const progress = total > 0 ? answered / total : 0;
  const current = quiz.questions[index] ?? null;
  const isLast = index >= total - 1;

  const scores = quiz.questions
    .map((question) => question.answer?.score)
    .filter((score): score is number => typeof score === "number");
  const averageScore =
    scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;

  async function answer(questionId: string, value: string) {
    setPendingId(questionId);
    setError(null);

    const response = await apiRequest<{ result: AnswerResultView; mastery: unknown[] }>(
      `/api/quizzes/${quiz.id}/answer`,
      { method: "POST", body: { questionId, answer: value } },
    );

    if (!response.ok) {
      setError(response.message);
      setPendingId(null);
      return;
    }

    const { result } = response.data;

    setQuiz((currentQuiz) => ({
      ...currentQuiz,
      questions: currentQuiz.questions.map((question) =>
        question.id === questionId ? { ...question, answer: result } : question,
      ),
    }));

    if (result.isCorrect === false && result.conceptsMissing.length > 0) {
      setMasteryNote(
        `Recorded against ${result.conceptsMissing.join(", ")} — it will come up again sooner.`,
      );
    } else {
      setMasteryNote(null);
    }

    setPendingId(null);
  }

  async function finish() {
    setCompleting(true);
    setError(null);

    const response = await apiRequest<{ quiz: QuizView }>(`/api/quizzes/${quiz.id}/complete`, {
      method: "POST",
    });

    if (!response.ok) {
      setError(response.message);
      setCompleting(false);
      return;
    }

    setQuiz(response.data.quiz);
    setCompleting(false);
    // Let the dashboard's mastery bars and activity feed catch up.
    router.refresh();
  }

  if (!current) {
    return (
      <Alert tone="warning" title="This quiz has no questions">
        It was generated before any material was processed, so there is nothing to answer.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Progress and the way out of the quiz */}
      <section className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
              {quiz.title ?? "Quiz"}
            </h1>
            <span className="text-sm text-[var(--color-ink-subtle)] tabular-nums">
              Question {index + 1} of {total}
            </span>
            {quiz.status === "COMPLETED" ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success-ink)]">
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                completed
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <ProgressBar
              value={progress}
              label={`${answered} of ${total} questions answered`}
              className="flex-1"
            />
            <ProgressValue value={progress} />
          </div>
        </div>

        <Button
          onClick={finish}
          disabled={completing || quiz.status === "COMPLETED"}
          className="w-full sm:w-auto"
          aria-busy={completing}
          variant={allAnswered ? "primary" : "outline"}
        >
          {quiz.status === "COMPLETED"
            ? "Completed"
            : completing
              ? "Finishing…"
              : allAnswered
                ? "Submit Quiz"
                : "Finish early"}
        </Button>
      </section>

      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}

      {masteryNote ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{masteryNote}</p>
      ) : null}

      {/* The current question */}
      <QuestionCard question={current}>
        {current.answer ? (
          <AnswerResult answer={current.answer} options={current.options} />
        ) : current.type === "MULTIPLE_CHOICE" ? (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2.5">
              {current.options.map((option, optionIndex) => {
                const isSelected = selected[current.id] === option.id;

                return (
                  <li key={option.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors",
                        "focus-within:border-[var(--color-brand-500)] focus-within:ring-4 focus-within:ring-[var(--color-brand-500)]/20",
                        isSelected
                          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                          : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]/60",
                      )}
                    >
                      <input
                        type="radio"
                        name={current.id}
                        value={option.id}
                        checked={isSelected}
                        disabled={pendingId === current.id}
                        onChange={() =>
                          setSelected((prev) => ({ ...prev, [current.id]: option.id }))
                        }
                        className="sr-only"
                      />

                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums",
                          isSelected
                            ? "border-transparent bg-[var(--color-brand-600)] text-white"
                            : "border-[var(--color-border-strong)] text-[var(--color-ink-subtle)]",
                        )}
                      >
                        {String.fromCharCode(65 + optionIndex)}
                      </span>

                      <span className="leading-6">{option.text}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-end">
              <Button
                onClick={() => answer(current.id, selected[current.id] ?? "")}
                disabled={
                  pendingId === current.id || !selected[current.id] || quiz.status === "COMPLETED"
                }
                className="w-full sm:w-auto"
              >
                {pendingId === current.id ? "Checking…" : "Submit answer"}
              </Button>
            </div>
          </div>
        ) : (
          <OpenEnded
            value={draft[current.id] ?? ""}
            onChange={(value) => setDraft((prev) => ({ ...prev, [current.id]: value }))}
            onSubmit={() => answer(current.id, draft[current.id] ?? "")}
            pending={pendingId === current.id || quiz.status === "COMPLETED"}
          />
        )}
      </QuestionCard>

      {/* Stepper */}
      <nav aria-label="Question navigation" className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
          <ChevronLeft aria-hidden="true" className="size-4" />
          Previous
        </Button>

        <span className="text-xs text-[var(--color-ink-subtle)] tabular-nums">
          {answered} of {total} answered
          {averageScore !== null ? ` · average ${Math.round(averageScore * 100)}%` : ""}
        </span>

        <Button
          variant="outline"
          onClick={() => setIndex((i) => i + 1)}
          disabled={isLast}
        >
          Next
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </nav>
    </div>
  );
}
