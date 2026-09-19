"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialActions } from "@/components/materials/material-actions";
import { cn, formatRelativeTime } from "@/lib/utils";
import { apiRequest } from "@/lib/api-client";

export type MaterialView = {
  id: string;
  filename: string;
  sizeBytes: number;
  status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  pageCount: number | null;
  createdAt: string;
  chunkCount: number;
  conceptCount: number;
};

const IN_FLIGHT: MaterialView["status"][] = ["QUEUED", "PROCESSING"];
const POLL_INTERVAL_MS = 2500;

type Filter = "ALL" | "PROCESSING" | "READY" | "FAILED";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "PROCESSING", label: "Processing" },
  { key: "READY", label: "Ready" },
  { key: "FAILED", label: "Failed" },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Status pill.
 *
 * Each processing state gets its own semantic colour and icon so QUEUED, PROCESSING,
 * READY and FAILED are distinguishable at a glance — the label still carries the state
 * on its own, so colour is never the only cue.
 */
function StatusBadge({ status }: { status: MaterialView["status"] }) {
  const map: Record<
    MaterialView["status"],
    { Icon: LucideIcon; label: string; variant: "warning" | "brand" | "success" | "danger" }
  > = {
    QUEUED: { Icon: Clock, label: "Queued", variant: "warning" },
    PROCESSING: { Icon: Loader2, label: "Processing", variant: "brand" },
    READY: { Icon: CheckCircle2, label: "Ready", variant: "success" },
    FAILED: { Icon: AlertTriangle, label: "Failed", variant: "danger" },
  };

  const { Icon, label, variant } = map[status];

  return (
    <Badge variant={variant} className="shrink-0 rounded-full px-2.5 py-1">
      <Icon
        aria-hidden="true"
        className={cn("size-3", status === "PROCESSING" && "animate-spin")}
      />
      {label}
    </Badge>
  );
}

/**
 * Material list with status polling.
 *
 * Polling runs only while something is in flight, so an idle page makes no requests.
 * When processing finishes, the server components are refreshed once so the Project
 * dashboard reflects the new concepts without a manual reload.
 *
 * The status tabs and the search filter the list that is already in memory — this
 * component has held the full set since it started polling — so neither adds a request,
 * a database query or a new client boundary.
 */
export function MaterialList({
  projectId,
  initialMaterials,
}: {
  projectId: string;
  initialMaterials: MaterialView[];
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState(initialMaterials);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  const inFlight = materials.some((material) => IN_FLIGHT.includes(material.status));
  const wasInFlight = useRef(inFlight);

  // Re-sync when the server sends fresh props (after router.refresh()).
  useEffect(() => {
    setMaterials(initialMaterials);
  }, [initialMaterials]);

  useEffect(() => {
    if (!inFlight) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      const result = await apiRequest<{ materials: MaterialView[] }>(
        `/api/materials?projectId=${projectId}`,
      );

      if (!cancelled && result.ok) {
        setMaterials(result.data.materials);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inFlight, projectId]);

  useEffect(() => {
    // Settled: pull the server-rendered pages back in step.
    if (wasInFlight.current && !inFlight) {
      router.refresh();
    }
    wasInFlight.current = inFlight;
  }, [inFlight, router]);

  async function handleRetry(materialId: string) {
    setBusyId(materialId);
    setActionError(null);

    const result = await apiRequest(`/api/materials/${materialId}`, { method: "POST" });

    if (!result.ok) setActionError(result.message);

    setBusyId(null);
    router.refresh();
  }

  async function handleDelete(materialId: string, filename: string) {
    if (!window.confirm(`Delete "${filename}"? Its chunks and concept links are removed too.`)) {
      return;
    }

    setBusyId(materialId);
    setActionError(null);

    const result = await apiRequest(`/api/materials/${materialId}`, { method: "DELETE" });

    if (!result.ok) setActionError(result.message);

    setBusyId(null);
    router.refresh();
  }

  if (materials.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No materials yet"
        body="Upload a PDF to build this project's knowledge base. Documents are parsed, chunked, and indexed automatically, then used by the Tutor and the quiz generator."
      />
    );
  }

  const needle = query.trim().toLowerCase();

  const visible = materials.filter((material) => {
    const matchesFilter =
      filter === "ALL" ||
      (filter === "PROCESSING" ? IN_FLIGHT.includes(material.status) : material.status === filter);

    return matchesFilter && (!needle || material.filename.toLowerCase().includes(needle));
  });

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <Alert tone="danger" role="alert">
          {actionError}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex items-center gap-5 border-b border-[var(--color-border-subtle)]"
        >
          {FILTERS.map((tab) => {
            const active = tab.key === filter;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                aria-pressed={active}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                  active
                    ? "border-[var(--color-brand-600)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-ink-subtle)] hover:text-[var(--color-ink-muted)]",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-ink-subtle)]"
          />
          <label htmlFor="material-search" className="sr-only">
            Search materials
          </label>
          <input
            id="material-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search materials..."
            className="h-10 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-inset)] pr-3 pl-9 text-sm text-[var(--color-ink)] shadow-xs transition-[border-color,box-shadow] placeholder:text-[var(--color-ink-subtle)] hover:border-[var(--color-ink-subtle)]/60 focus:border-[var(--color-brand-500)] focus:ring-4 focus:ring-[var(--color-brand-500)]/20 focus:outline-none"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          compact
          icon={FileText}
          title="Nothing matches"
          body={
            needle
              ? `No material here matches "${query}". Try another word, or switch back to All.`
              : "No material is in this state right now."
          }
        />
      ) : (
        <ul className="card flex flex-col p-2">
          {visible.map((material) => {
            const busy = busyId === material.id;

            return (
              <li
                key={material.id}
                className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-[var(--color-surface-muted)]/50"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]"
                >
                  <FileText className="size-4" />
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className="min-w-0 truncate text-sm font-medium text-[var(--color-ink)]"
                    title={material.filename}
                  >
                    {material.filename}
                  </span>

                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--color-ink-subtle)]">
                    {material.pageCount ? (
                      <span className="tabular-nums">{material.pageCount} pages</span>
                    ) : null}
                    {material.status === "READY" ? (
                      <span className="tabular-nums">{material.chunkCount} chunks</span>
                    ) : null}
                    <span className="tabular-nums">{formatBytes(material.sizeBytes)}</span>
                    <span>{formatRelativeTime(material.createdAt)}</span>
                  </span>

                  {/*
                    Indeterminate. The pipeline reports a status, not a completion
                    fraction, so this shows that work is happening without inventing a
                    percentage. The badge above already states the state in words, which is
                    why the bar is decorative.
                  */}
                  {IN_FLIGHT.includes(material.status) ? (
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-1 w-full max-w-xs overflow-hidden rounded-full bg-[var(--color-brand-50)]"
                    >
                      <span className="block h-full w-1/3 animate-pulse rounded-full bg-[var(--color-brand-500)]" />
                    </span>
                  ) : null}

                  {material.status === "FAILED" && material.error ? (
                    <p className="flex items-start gap-1.5 pt-0.5 text-xs leading-5 text-[var(--color-danger-ink)]">
                      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{material.error}</span>
                    </p>
                  ) : null}
                </div>

                <StatusBadge status={material.status} />

                <MaterialActions
                  filename={material.filename}
                  canRetry={material.status === "FAILED"}
                  busy={busy}
                  onRetry={() => void handleRetry(material.id)}
                  onDelete={() => void handleDelete(material.id, material.filename)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
