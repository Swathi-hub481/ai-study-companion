"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Puts a failed or dead-lettered job back on the queue.
 *
 * §9 keeps exhausted jobs *visible* rather than discarding them; this is what makes that
 * visibility actionable.
 */
export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);

    const result = await apiRequest(`/api/admin/jobs/${jobId}/retry`, { method: "POST" });

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button variant="secondary" size="sm" onClick={retry} disabled={pending}>
        <RefreshCw aria-hidden="true" className={cn("size-3.5", pending && "animate-spin")} />
        Retry
      </Button>
      {error ? (
        <span
          role="alert"
          className="max-w-[16rem] text-right text-xs text-[var(--color-danger-ink)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
