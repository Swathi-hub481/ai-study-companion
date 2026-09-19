"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api-client";

export function CreateProjectForm({
  spaceId,
  defaultOpen = false,
}: {
  spaceId: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setFormError(null);
    setFieldErrors({});
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    setFormError(null);

    const result = await apiRequest("/api/projects", {
      method: "POST",
      body: { spaceId, name, description, goal },
    });

    if (!result.ok) {
      setFormError(result.message);
      setFieldErrors(result.details ?? {});
      setPending(false);
      return;
    }

    setName("");
    setDescription("");
    setGoal("");
    setPending(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="md" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        New project
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Create a project"
        description="A project is a focused learning journey. Its goal shapes every answer the Tutor gives you here."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <Field label="Name" htmlFor="project-name" error={fieldErrors.name}>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Supervised Learning Deep Dive"
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "project-name-error" : undefined}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="project-description"
            error={fieldErrors.description}
            hint="What will you work through?"
          >
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              required
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={
                fieldErrors.description ? "project-description-error" : "project-description-hint"
              }
              placeholder="Work through supervised learning techniques and how to choose between them."
            />
          </Field>

          <Field
            label="Learning goal"
            htmlFor="project-goal"
            error={fieldErrors.goal}
            hint="Stated so it can be assessed. The Tutor and quizzes aim at this."
          >
            <Textarea
              id="project-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={2}
              required
              aria-invalid={Boolean(fieldErrors.goal)}
              aria-describedby={fieldErrors.goal ? "project-goal-error" : "project-goal-hint"}
              placeholder="Be able to explain, compare, and apply supervised learning algorithms."
            />
          </Field>

          {formError ? (
            <Alert tone="danger" role="alert">
              {formError}
            </Alert>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
