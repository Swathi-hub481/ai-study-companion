"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const COLOURS = [
  { value: "#6366f1", name: "Indigo" },
  { value: "#0ea5e9", name: "Sky" },
  { value: "#10b981", name: "Emerald" },
  { value: "#f59e0b", name: "Amber" },
  { value: "#ef4444", name: "Red" },
  { value: "#a855f7", name: "Purple" },
];

export function CreateSpaceForm({
  defaultOpen = false,
  label = "New space",
}: {
  defaultOpen?: boolean;
  /** Trigger text. The Spaces index asks for "Create Space"; Home keeps "New space". */
  label?: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(COLOURS[0]!.value);
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

    const result = await apiRequest("/api/spaces", {
      method: "POST",
      body: { name, description, color },
    });

    if (!result.ok) {
      setFormError(result.message);
      setFieldErrors(result.details ?? {});
      setPending(false);
      return;
    }

    setName("");
    setDescription("");
    setPending(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="md" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        {label}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Create a space"
        description="A space is any broad area you want to learn — a skill, a certification, or a personal interest."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <Field label="Name" htmlFor="space-name" error={fieldErrors.name}>
            <Input
              id="space-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Machine Learning Foundations"
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "space-name-error" : undefined}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="space-description"
            error={fieldErrors.description}
            hint="What does this area cover?"
          >
            <Textarea
              id="space-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              required
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={
                fieldErrors.description ? "space-description-error" : "space-description-hint"
              }
              placeholder="Core concepts behind modern machine learning."
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium">Colour</legend>

            <div className="flex flex-wrap gap-2">
              {COLOURS.map((option) => {
                const selected = color === option.value;

                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                        : "border-[var(--color-border-subtle)] text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)]",
                    )}
                  >
                    <input
                      type="radio"
                      name="space-colour"
                      value={option.value}
                      checked={selected}
                      onChange={() => setColor(option.value)}
                      className="sr-only"
                    />

                    <span
                      aria-hidden="true"
                      className="flex size-4 items-center justify-center rounded-full"
                      style={{ backgroundColor: option.value }}
                    >
                      {selected ? <Check className="size-2.5 text-white" /> : null}
                    </span>

                    {option.name}
                  </label>
                );
              })}
            </div>
          </fieldset>

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
                "Create space"
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
