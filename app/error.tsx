"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

/**
 * Root error boundary.
 *
 * Without this, a thrown server error renders the framework's default page — which tells
 * the learner nothing and offers no way out. The digest is shown because it is the same
 * value the server logged, so a report can be matched to a log line.
 *
 * This one sits above the shell, so it renders its own full-height frame. The
 * `(app)`-level boundary catches the same faults one level deeper and keeps the sidebar.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged the fault; this keeps the browser console useful too.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
      <StatePanel
        tone="danger"
        icon={AlertTriangle}
        eyebrow="Error"
        title="Something went wrong"
        body="This page could not be rendered. Nothing you have saved was lost — trying again usually works."
      >
        <Button onClick={reset}>
          <RotateCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
        <Link href="/home" className={buttonVariants({ variant: "outline" })}>
          Go to Home
        </Link>
      </StatePanel>

      {error.digest ? (
        <p className="mt-6 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs break-all text-[var(--color-ink-subtle)]">
          Reference: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
