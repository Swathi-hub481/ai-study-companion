"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

/**
 * Error boundary for the authenticated area.
 *
 * The root boundary replaces the whole document, which throws away the sidebar and the
 * account menu. Catching the same faults here instead means a failed page keeps the
 * navigation the learner needs to get somewhere that works.
 *
 * Behaviour is unchanged: the error still propagates to Next, is still logged server-side,
 * and the digest is still surfaced for support.
 */
export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col justify-center py-12">
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
    </div>
  );
}
