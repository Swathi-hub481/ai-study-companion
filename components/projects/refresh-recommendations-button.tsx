"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

/**
 * Asks the worker for a fresh set of recommendations.
 *
 * Generation is a model call, so the request only *queues* it (202). The note matters:
 * without it, a learner would see nothing change and reasonably conclude it was broken,
 * because the work happens after the response.
 */
export function RefreshRecommendationsButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPending(true);
    setError(null);
    setNote(null);

    const result = await apiRequest(`/api/projects/${projectId}/recommendations/refresh`, {
      method: "POST",
    });

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }

    setNote("Queued — new suggestions appear once the worker has generated them.");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {note ? <span className="text-xs text-[var(--color-ink-subtle)]">{note}</span> : null}

      {error ? (
        <span role="alert" className="text-xs text-[var(--color-danger-ink)]">
          {error}
        </span>
      ) : null}

      <Button variant="outline" size="sm" onClick={refresh} disabled={pending}>
        <RefreshCw
          aria-hidden="true"
          className={`size-3.5 ${pending ? "animate-spin" : "transition-transform group-hover:rotate-90"}`}
        />
        {pending ? "Queueing…" : "Regenerate"}
      </Button>
    </div>
  );
}
