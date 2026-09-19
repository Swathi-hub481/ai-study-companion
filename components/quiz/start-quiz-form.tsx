"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { apiRequest } from "@/lib/api-client";
import {
  QUIZ_LENGTH_DEFAULT,
  QUIZ_LENGTH_MAX,
  QUIZ_LENGTH_MIN,
  type QuizView,
} from "@/lib/learning/quiz";

/**
 * Starts a quiz.
 *
 * Generation is a model call per question, so this can take a few seconds — the button
 * says so rather than leaving the learner wondering whether the click registered.
 *
 * The two controls map exactly onto what the generator accepts: the selection policy
 * picks the concepts, and difficulty follows mastery, so neither is a knob here.
 */
export function StartQuizForm({
  projectId,
  spaceId,
}: {
  projectId: string;
  spaceId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"QUIZ" | "ASSESSMENT">("QUIZ");
  const [length, setLength] = useState(QUIZ_LENGTH_DEFAULT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lengths = Array.from(
    { length: QUIZ_LENGTH_MAX - QUIZ_LENGTH_MIN + 1 },
    (_, index) => QUIZ_LENGTH_MIN + index,
  );

  async function start() {
    setPending(true);
    setError(null);

    const response = await apiRequest<{ quiz: QuizView }>("/api/quizzes", {
      method: "POST",
      body: { projectId, mode, length },
    });

    if (!response.ok) {
      setError(response.message);
      setPending(false);
      return;
    }

    router.push(`/spaces/${spaceId}/projects/${projectId}/quiz/${response.data.quiz.id}`);
  }

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-4 text-[var(--color-brand-500)]" />
        <h2 className="text-base font-semibold tracking-tight">Quiz Settings</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Question Type" htmlFor="quiz-mode">
          <Select
            id="quiz-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as "QUIZ" | "ASSESSMENT")}
            disabled={pending}
          >
            <option value="QUIZ">Multiple choice (MCQ)</option>
            <option value="ASSESSMENT">Open-ended (explanation first)</option>
          </Select>
        </Field>

        <Field label="Number of Questions" htmlFor="quiz-length">
          <Select
            id="quiz-length"
            value={length}
            onChange={(event) => setLength(Number(event.target.value))}
            disabled={pending}
          >
            {lengths.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={pending} size="lg">
          {pending ? (
            <>
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Generating questions…
            </>
          ) : (
            "Generate Quiz"
          )}
        </Button>

        <p className="text-xs text-[var(--color-ink-subtle)]">
          Questions come from this project&apos;s own material.
        </p>
      </div>

      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}
