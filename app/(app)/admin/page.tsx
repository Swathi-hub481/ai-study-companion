import type { Metadata } from "next";
import {
  Activity,
  ClipboardList,
  Cpu,
  FileText,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { getGlobalAnalytics } from "@/lib/services/analytics";
import { getLatestEvaluation, getSystemHealth } from "@/lib/services/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { cn, formatCount, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

/**
 * Queue statuses read as a pipeline, so each one gets a fixed tone rather than relying
 * on object key order.
 */
const JOB_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  PENDING: "warning",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  DEAD: "danger",
};

/**
 * The operations console.
 *
 * Composition follows the reference — a heading, a row of summary cards, then a wide
 * column of activity beside a narrower runtime panel. Every figure is one the analytics
 * and health services already compute; nothing here is a check the application does not
 * actually perform, so the runtime panel marks the database (which is probed) and lists
 * the rest as configuration.
 */
export default async function AdminOverviewPage() {
  const user = await requireAdminPage();

  const [analytics, health, evaluation] = await Promise.all([
    getGlobalAnalytics(user),
    getSystemHealth(user),
    getLatestEvaluation(user),
  ]);

  const { totals, ai, jobs } = analytics;

  const busiestActivity = Math.max(1, ...analytics.activityByType.map((entry) => entry.count));
  const activityTotal = Math.max(
    1,
    analytics.activityByType.reduce((sum, entry) => sum + entry.count, 0),
  );

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Instance-wide totals, activity and runtime state across the last {analytics.windowDays}{" "}
          days.
        </p>
      </header>

      <AdminNav />

      <section aria-label="Instance totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={totals.users}
          hint={`${totals.admins} administrator${totals.admins === 1 ? "" : "s"}`}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="Spaces / Projects"
          value={`${totals.spaces} / ${totals.projects}`}
          hint="across all users"
          icon={Layers}
          tone="accent"
        />
        <StatCard
          label="Materials"
          value={totals.materials}
          hint={`${totals.readyMaterials} ready`}
          icon={FileText}
        />
        <StatCard
          label="Concepts"
          value={totals.concepts}
          hint="extracted from material"
          icon={Lightbulb}
          tone="success"
        />
        <StatCard
          label="Quizzes completed"
          value={totals.quizzesCompleted}
          hint={`${totals.quizzes} started`}
          icon={ListChecks}
        />
        <StatCard
          label="Average mastery"
          value={formatPercent(analytics.mastery.average)}
          hint="all concepts, all users"
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          label="AI calls"
          value={formatCount(ai.calls)}
          hint={`${ai.failures} failed · ${formatUsd(ai.costUsd)}`}
          icon={Cpu}
          tone={ai.failures > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Conversations"
          value={totals.conversations}
          hint="tutor threads"
          icon={MessageSquare}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <section className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">
                Daily activity (last {analytics.windowDays} days)
              </h2>
              <Badge variant="neutral">{formatCount(analytics.activityTotal)} events</Badge>
            </div>

            <ActivityHeatmap buckets={analytics.activity} />
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-base font-semibold tracking-tight">Activity by type</h2>

            {analytics.activityByType.length === 0 ? (
              <EmptyState
                compact
                icon={Activity}
                title="No activity in this window"
                body="Events appear here as learners upload material, ask the Tutor and take quizzes."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {analytics.activityByType.slice(0, 8).map((entry) => {
                  const share = Math.round((entry.count / activityTotal) * 100);

                  return (
                    <li key={entry.type} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate text-[var(--color-ink-muted)]">
                          {entry.type.toLowerCase().replace(/_/g, " ")}
                        </span>
                        <span className="shrink-0 text-[var(--color-ink-subtle)] tabular-nums">
                          {entry.count} · {share}%
                        </span>
                      </div>

                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-[var(--color-brand-500)] to-[var(--color-accent)]"
                          style={{
                            width: `${Math.max(2, (entry.count / busiestActivity) * 100)}%`,
                          }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold tracking-tight">System health</h2>

          <dl className="flex flex-col">
            <StatusRow
              label="Database"
              value={health.database ? "up" : "down"}
              tone={health.database ? "success" : "danger"}
            />
            <ConfigRow label="Environment" value={health.config.environment} />
            <ConfigRow
              label="Generation provider"
              value={`${health.config.aiProvider} (${health.config.aiEmbedProvider} embeddings)`}
            />
            <ConfigRow
              label="Embedding model"
              value={`${health.config.embedModel} · ${health.config.embedDimensions}d`}
            />
            <ConfigRow label="Storage driver" value={health.config.storageDriver} />
            <ConfigRow label="OCR" value={health.config.ocrEnabled ? "enabled" : "disabled"} />
            <ConfigRow
              label="Retrieval threshold"
              value={health.config.retrievalMinScore.toFixed(2)}
              mono
            />
            <ConfigRow label="Process uptime" value={`${health.process.uptimeSeconds}s`} mono />
            <ConfigRow label="Resident memory" value={`${health.process.rssMb} MB`} mono />
          </dl>

          <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-[var(--color-ink-muted)]">Stale running jobs</span>
              <span className="font-medium tabular-nums">{health.staleRunning}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-[var(--color-ink-muted)]">Oldest pending job</span>
              <span className="text-right font-medium">
                {health.oldestPendingAt ? formatRelativeTime(health.oldestPendingAt) : "—"}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold tracking-tight">Background processing</h2>

          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(jobs).map(([status, count]) => (
              <li
                key={status}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-3 py-2"
              >
                <Badge variant={JOB_STATUS_TONE[status] ?? "neutral"}>{status.toLowerCase()}</Badge>
                <span className="text-base leading-none font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold tracking-tight">Latest evaluation</h2>

          {evaluation ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <Badge variant={evaluation.report.ok ? "success" : "danger"}>
                  {evaluation.report.ok ? "Passed" : "Failed"}
                </Badge>
                <span className="text-[var(--color-ink-muted)]">
                  {evaluation.report.assertions.passed} assertion(s) passed,{" "}
                  {evaluation.report.assertions.failed} failed
                  {evaluation.report.metrics.failed > 0
                    ? ` · ${evaluation.report.metrics.failed} metric(s) below floor`
                    : ""}{" "}
                  · {formatRelativeTime(evaluation.completedAt)}
                </span>
              </div>

              <ul className="flex flex-wrap gap-2">
                {Object.entries(evaluation.report.suites).map(([suite, tally]) => (
                  <li key={suite}>
                    <Badge variant={tally.failed > 0 ? "warning" : "neutral"}>
                      {suite} ·{" "}
                      <span className="tabular-nums">
                        {tally.passed}/{tally.passed + tally.failed}
                      </span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState
              compact
              icon={ClipboardList}
              title="No evaluation run yet"
              body="Run `npm run eval` to execute the Tutor, retrieval, assessment and recommendation suites."
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** A probed status: the dot and the word both carry it, so colour is never the only cue. */
function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] py-2 first:border-t-0">
      <dt className="flex items-center gap-2 text-[var(--color-ink-muted)]">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            tone === "success" ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]",
          )}
        />
        {label}
      </dt>
      <dd className="font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

/** A configured value. Deliberately undotted — the application does not probe these. */
function ConfigRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[var(--color-border-subtle)] py-2">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right font-medium text-[var(--color-ink)]",
          mono && "tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
