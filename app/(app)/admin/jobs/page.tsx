import type { Metadata } from "next";
import { JobStatus } from "@prisma/client";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ServerCrash } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { listJobs } from "@/lib/services/admin";
import { countJobsByStatus } from "@/lib/jobs/queue";
import { AdminNav } from "@/components/admin/admin-nav";
import { RetryJobButton } from "@/components/admin/retry-job-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { adminJobsQuerySchema } from "@/lib/validation/admin";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Background jobs" };

type PageProps = { searchParams: Promise<{ status?: string; limit?: string }> };

/** StatCard has no `info` tone, so the queue summary and the row badges differ only there. */
const CARD_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  PENDING: "warning",
  RUNNING: "brand",
  COMPLETED: "success",
  FAILED: "danger",
  DEAD: "danger",
};

const BADGE_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> =
  {
    PENDING: "warning",
    RUNNING: "info",
    COMPLETED: "success",
    FAILED: "danger",
    DEAD: "danger",
  };

const STATUS_ICON: Record<string, LucideIcon> = {
  PENDING: Clock,
  RUNNING: Loader2,
  COMPLETED: CheckCircle2,
  FAILED: AlertTriangle,
  DEAD: ServerCrash,
};

/**
 * How long a job took from creation to completion.
 *
 * Measured from `createdAt` rather than `lockedAt`, so it includes the time the job spent
 * queued — that is the number an operator actually feels. Absent while a job is still
 * running, because there is no finish time to subtract.
 */
function formatDuration(createdAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";

  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  return `${Math.round(ms / 60_000)}m`;
}

export default async function AdminJobsPage({ searchParams }: PageProps) {
  const admin = await requireAdminPage();
  const filters = await searchParams;

  // Invalid filter values fall back to the unfiltered view rather than erroring: a
  // bookmarked URL with a stale status should still render something useful.
  const parsed = adminJobsQuerySchema.safeParse(filters);
  const options = parsed.success ? parsed.data : {};

  const [jobs, counts] = await Promise.all([listJobs(admin, options), countJobsByStatus()]);

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Background jobs</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Retries, dead letters and their errors. Nothing is discarded — an exhausted job stays here
          with the reason it failed.
        </p>
      </header>

      <AdminNav />

      <section
        aria-label="Queue status"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        {Object.entries(counts).map(([status, count]) => (
          <StatCard
            key={status}
            label={status.toLowerCase()}
            value={count}
            tone={CARD_TONE[status] ?? "neutral"}
            icon={STATUS_ICON[status] ?? Clock}
          />
        ))}
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold tracking-tight">Filter</h2>

        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Status" htmlFor="status" className="w-full sm:w-56">
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Any status</option>
              {Object.values(JobStatus).map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit">Apply</Button>
        </form>
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Jobs</h2>
          <Badge variant="neutral">
            {jobs.length} row{jobs.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="No jobs match that filter"
            body="Try a different status, or clear the filter to see every job."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* The caption is the table's accessible name; without one a screen reader
                  announces "table" with no indication of what it contains. */}
              <caption className="sr-only">
                Background jobs, with their status, attempts, timing and any recorded error
              </caption>

              <thead>
                <tr className="text-left text-[11px] tracking-[0.08em] text-[var(--color-ink-subtle)] uppercase">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Job
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">
                    Attempts
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Created
                  </th>
                  <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">
                    Duration
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="align-top transition-colors hover:bg-[var(--color-surface-muted)]/50"
                  >
                    <td className="max-w-[22rem] py-3.5 pr-4">
                      <span className="block font-medium text-[var(--color-ink)]">
                        {job.type.toLowerCase().replace(/_/g, " ")}
                      </span>

                      {job.lastError ? (
                        <span className="mt-1 line-clamp-2 block text-xs break-words text-[var(--color-danger-ink)]">
                          {job.lastError.slice(0, 300)}
                        </span>
                      ) : null}
                    </td>

                    <td className="py-3.5 pr-4">
                      <Badge variant={BADGE_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
                    </td>

                    <td className="hidden py-3.5 pr-4 tabular-nums text-[var(--color-ink-muted)] sm:table-cell">
                      {job.attempts}/{job.maxAttempts}
                    </td>

                    <td className="py-3.5 pr-4 text-[var(--color-ink-muted)]">
                      {formatRelativeTime(job.createdAt)}
                    </td>

                    <td className="hidden py-3.5 pr-4 tabular-nums text-[var(--color-ink-muted)] sm:table-cell">
                      {formatDuration(job.createdAt, job.completedAt)}
                    </td>

                    <td className="py-3 text-right">
                      {job.status === "FAILED" || job.status === "DEAD" ? (
                        <RetryJobButton jobId={job.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
