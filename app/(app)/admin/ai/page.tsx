import type { Metadata } from "next";
import { Bot, CircleCheck, CircleX, ClipboardList, Coins, Sparkles, Timer } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { getAiUsage, getLatestEvaluation } from "@/lib/services/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { cn, formatCount, formatPercent, formatRelativeTime, formatUsd } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · AI usage" };

type PageProps = { searchParams: Promise<{ days?: string }> };

/**
 * Horizontal share bar.
 *
 * A track plus a thin fill and the percentage beside it, which is how the reference
 * presents a breakdown and how a share of a total is actually read: the bar answers
 * "how much of the whole", the number answers "how many".
 */
function ShareBar({ share, className }: { share: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-inset)]",
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-gradient-to-r from-[var(--color-brand-500)] to-[var(--color-accent)]"
        style={{ width: `${Math.max(2, share)}%` }}
      />
    </span>
  );
}

export default async function AdminAiPage({ searchParams }: PageProps) {
  const admin = await requireAdminPage();
  const { days } = await searchParams;

  const parsed = Number(days);
  const windowDays = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

  const [usage, evaluation] = await Promise.all([
    getAiUsage(admin, { days: windowDays }),
    getLatestEvaluation(admin),
  ]);

  const totalCalls = usage.totals.calls;
  const share = (calls: number) => (totalCalls > 0 ? Math.round((calls / totalCalls) * 100) : 0);

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
          <p className="max-w-2xl text-sm text-[var(--color-ink-muted)]">
            Every model call is recorded with its feature, model, tokens, latency and outcome.
          </p>
        </div>

        {/* The window is read from `?days=` by the service; this control only surfaces it. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Range" htmlFor="days" className="w-full sm:w-44">
            <Select id="days" name="days" defaultValue={String(usage.windowDays)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </Field>

          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>
      </header>

      <AdminNav />

      <section aria-label="AI usage totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Calls"
          value={formatCount(usage.totals.calls)}
          hint={`last ${usage.windowDays} days`}
          icon={Sparkles}
          tone="brand"
        />
        <StatCard
          label="Failures"
          value={usage.totals.failures}
          hint={
            usage.totals.calls > 0
              ? `${formatPercent(usage.totals.failures / usage.totals.calls)} of calls`
              : "no calls"
          }
          tone={usage.totals.failures > 0 ? "danger" : "success"}
          icon={usage.totals.failures > 0 ? CircleX : CircleCheck}
        />
        <StatCard
          label="Tokens"
          value={formatCount(usage.totals.promptTokens + usage.totals.completionTokens)}
          hint={`${formatCount(usage.totals.promptTokens)} in · ${formatCount(
            usage.totals.completionTokens,
          )} out`}
          icon={Timer}
          tone="accent"
        />
        <StatCard
          label="Estimated cost"
          value={formatUsd(usage.totals.costUsd)}
          hint={`${usage.totals.averageLatencyMs}ms average latency`}
          icon={Coins}
        />
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold tracking-tight">
          Calls per day (last {usage.windowDays} days)
        </h2>

        <ActivityHeatmap buckets={usage.series} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold tracking-tight">By feature</h2>

          {usage.byFeature.length === 0 ? (
            <EmptyState
              compact
              icon={Sparkles}
              title="No calls in this window"
              body="No feature recorded a model call during the selected period."
            />
          ) : (
            <ul className="flex flex-col gap-3.5">
              {usage.byFeature.map((entry) => (
                <li key={entry.feature} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate text-[var(--color-ink-muted)]">
                      {entry.feature.toLowerCase().replace(/_/g, " ")}
                    </span>
                    <span className="shrink-0 text-[var(--color-ink-subtle)] tabular-nums">
                      {entry.calls} · {entry.averageLatencyMs}ms
                    </span>
                  </div>

                  <span className="flex items-center gap-3">
                    <ShareBar share={share(entry.calls)} className="flex-1" />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--color-ink-subtle)]">
                      {share(entry.calls)}%
                    </span>
                  </span>

                  {entry.failures > 0 ? (
                    <span className="text-xs text-[var(--color-danger-ink)]">
                      {entry.failures} failed
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold tracking-tight">By model</h2>

          {usage.byModel.length === 0 ? (
            <EmptyState
              compact
              icon={Bot}
              title="No calls in this window"
              body="No model recorded a call during the selected period."
            />
          ) : (
            <ul className="flex flex-col gap-3.5">
              {usage.byModel.map((entry) => (
                <li key={entry.model} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate text-[var(--color-ink-muted)]">{entry.model}</span>
                    <span className="shrink-0 text-[var(--color-ink-subtle)] tabular-nums">
                      {entry.calls} · {entry.averageLatencyMs}ms
                    </span>
                  </div>

                  <span className="flex items-center gap-3">
                    <ShareBar share={share(entry.calls)} className="flex-1" />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--color-ink-subtle)]">
                      {share(entry.calls)}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Recent failures</h2>
          {usage.totals.failures > 0 ? (
            <Badge variant="danger">{usage.totals.failures} total</Badge>
          ) : null}
        </div>

        {usage.recentFailures.length === 0 ? (
          <EmptyState
            compact
            icon={CircleCheck}
            title="No failed calls"
            body="No model call failed during the selected period."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {usage.recentFailures.map((failure, index) => (
              <li
                key={`${failure.at}-${index}`}
                className="flex flex-col gap-1 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)]/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant="danger">Failed</Badge>
                    <span className="truncate text-sm font-medium">
                      {failure.feature.toLowerCase().replace(/_/g, " ")} · {failure.model}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-danger-ink)] tabular-nums">
                    {formatRelativeTime(failure.at)}
                  </span>
                </div>
                <p className="text-xs break-words text-[var(--color-danger-ink)]">
                  {failure.error ?? "no error recorded"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold tracking-tight">Latest evaluation</h2>

        {!evaluation ? (
          <EmptyState
            compact
            icon={ClipboardList}
            title="No evaluation run yet"
            body="Run `npm run eval` to execute the Tutor, retrieval, assessment and recommendation suites against a fixture project."
          />
        ) : (
          <div className="flex flex-col gap-4">
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

            <ul className="flex flex-col">
              {evaluation.report.checks.map((entry, index) => {
                // A metric below its floor is a signal to look at, not a failed requirement.
                const isMetric = entry.kind === "metric";
                const variant = isMetric
                  ? entry.passed
                    ? "info"
                    : "warning"
                  : entry.passed
                    ? "success"
                    : "danger";
                const label = isMetric
                  ? entry.passed
                    ? "Metric"
                    : "Metric below floor"
                  : entry.passed
                    ? "Pass"
                    : "Fail";

                return (
                  <li
                    key={`${entry.suite}-${entry.name}`}
                    className={cn(
                      "flex flex-col gap-1 py-2.5",
                      index > 0 && "border-t border-[var(--color-border-subtle)]",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={variant}>{label}</Badge>
                      <span className="text-sm">{entry.name}</span>
                    </div>
                    <span className="text-xs text-[var(--color-ink-subtle)]">{entry.detail}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
