"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * PDF upload.
 *
 * Uses `fetch` directly rather than the shared JSON helper because the body is
 * multipart — the Content-Type header must be left for the browser to set, including
 * its boundary.
 *
 * The control is still a native `<input type="file">`; it sits inside a `<label>` styled
 * as the primary action, so the browser's own picker is what opens and the control stays
 * reachable by keyboard (the label shows a focus ring via `focus-within`, since the input
 * it wraps is visually hidden). Picking a file reveals the filename and turns the label
 * into a "Replace" affordance, so submitting stays an explicit second step — exactly the
 * two-step flow this page has always had.
 */
export function MaterialUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Display only — mirrors the native control's selection so the control can show a name.
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF to upload.");
      return;
    }

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.append("projectId", projectId);
    formData.append("file", file);

    let response: Response;

    try {
      response = await fetch("/api/materials", { method: "POST", body: formData });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "The upload failed.");
      setPending(false);
      return;
    }

    if (inputRef.current) inputRef.current.value = "";
    setFileName(null);
    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {fileName ? (
          <span className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-2.5 py-1.5 text-xs text-[var(--color-ink-muted)]">
            <FileText aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate" title={fileName}>
              {fileName}
            </span>
          </span>
        ) : null}

        <label
          className={cn(
            buttonVariants({ variant: fileName ? "outline" : "primary", size: "md" }),
            "cursor-pointer focus-within:ring-4 focus-within:ring-[var(--color-brand-500)]/25",
          )}
        >
          <CloudUpload aria-hidden="true" className="size-4" />
          {fileName ? "Replace" : "Upload Material"}

          <input
            ref={inputRef}
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            disabled={pending}
            onChange={(event) => {
              setFileName(event.target.files?.[0]?.name ?? null);
              setError(null);
            }}
            aria-describedby={error ? "material-upload-error" : undefined}
            className="sr-only"
          />
        </label>

        {fileName ? (
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CloudUpload aria-hidden="true" className="size-4" />
            )}
            {pending ? "Uploading…" : "Upload"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div id="material-upload-error">
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
