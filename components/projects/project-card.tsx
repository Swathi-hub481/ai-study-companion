import Link from "next/link";
import { AlertTriangle, ArrowRight, FileText, Lightbulb } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { masteryBand, formatRelativeTime } from "@/lib/utils";
import type { NextAction } from "@/lib/learning/next-action";

const SOURCE_LABELS: Record<NextAction["source"], string> = {
  recommendation: "Generated from your recent results",
  heuristic: "From your current progress",
};

const BAND_COLOURS = {
  low: "var(--color-mastery-low)",
  mid: "var(--color-mastery-mid)",
  high: "var(--color-mastery-high)",
} as const;

/**
 * The recommended next action.
 *
 * Both where it came from and why it was suggested are shown. A generated suggestion and
 * a computed rule are not the same kind of claim, and presenting either as an
 * authoritative instruction would be dishonest. Its visual weight is deliberately the
 * heaviest thing on the page — it is the one action the dashboard exists to produce.
 */
export function NextActionCard({
  action,
  title = "Recommended next step",
}: {
  action: NextAction;
  title?: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-[var(--color-brand-500)]"
      />

      <div className="flex flex-col gap-3 pl-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-brand-700)] uppercase">
            <Lightbulb aria-hidden="true" className="size-3.5" />
            {title}
          </span>

          <Badge variant="brand" className="bg-[var(--color-surface)]/70">
            {SOURCE_LABELS[action.source]}
          </Badge>
        </div>

        <h3 className="text-lg leading-snug font-semibold tracking-tight text-[var(--color-brand-800)]">
          {action.title}
        </h3>

        <p className="max-w-3xl text-sm leading-6 text-[var(--color-brand-700)]">{action.body}</p>

        <p className="text-xs text-[var(--color-brand-700)]/80">{action.basis}</p>
      </div>
    </section>
  );
}

/**
 * A Project row on a Space page.
 *
 * A full-width row rather than a tile, as the reference shows: an icon, the name with
 * its mastery percentage, the description, and a progress bar underneath. A stacked list
 * reads better than a grid once every card carries a progress bar, because the bars line
 * up and become comparable at a glance.
 */
export function ProjectCard({
  spaceId,
  projectId,
  name,
  description,
  mastery,
  updatedAt,
  materialCount,
  failedMaterials,
  accent = "var(--color-brand-500)",
}: {
  spaceId: string;
  projectId: string;
  name: string;
  description: string;
  /** 0..1 estimated mastery, already averaged across the Project's concepts. */
  mastery: number;
  updatedAt: Date;
  materialCount: number;
  failedMaterials: number;
  accent?: string;
}) {
  const percent = Math.round(Math.min(Math.max(mastery, 0), 1) * 100);

  return (
    <Link
      href={`/spaces/${spaceId}/projects/${projectId}`}
      className="card-interactive group flex items-start gap-4 p-4 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl"
        style={{
          backgroundColor: `color-mix(in oklab, ${accent} 18%, transparent)`,
          color: accent,
        }}
      >
        <FileText className="size-5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight transition-colors group-hover:text-[var(--color-brand-600)]">
            {name}
          </h3>

          <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--color-ink-muted)]">
            {percent}%
          </span>
        </div>

        <p className="line-clamp-1 text-[13px] leading-5 text-[var(--color-ink-muted)]">
          {description}
        </p>

        <ProgressBar
          value={mastery}
          label={`${name} mastery`}
          size="sm"
          colour={BAND_COLOURS[masteryBand(mastery)]}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-subtle)]">
          <span>Updated {formatRelativeTime(updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {materialCount} {materialCount === 1 ? "material" : "materials"}
          </span>

          {failedMaterials > 0 ? (
            <span className="flex items-center gap-1 text-[var(--color-danger-ink)]">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              {failedMaterials} failed
            </span>
          ) : null}
        </div>
      </div>

      <ArrowRight
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-[var(--color-ink-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)]"
      />
    </Link>
  );
}
