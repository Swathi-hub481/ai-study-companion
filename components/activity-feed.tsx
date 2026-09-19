import {
  AlertTriangle,
  FileCheck2,
  FileUp,
  FolderKanban,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  ServerCrash,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { activityLabel } from "@/lib/analytics/activity-types";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

export type ActivityFeedItem = {
  id: string;
  type: string;
  createdAt: Date;
  payload: unknown;
};

type Presentation = { icon: LucideIcon; tone: "brand" | "success" | "warning" | "danger" | "neutral" };

const TONE_CLASSES: Record<Presentation["tone"], string> = {
  brand: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-600)]",
  success:
    "border-[var(--color-success-soft)] bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
  warning:
    "border-[var(--color-warning-soft)] bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
  danger:
    "border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
  neutral:
    "border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[var(--color-ink-subtle)]",
};

/**
 * An event's icon and tone.
 *
 * Derived from the type prefix rather than a 17-entry table, so a new event type
 * degrades to a sensible neutral marker instead of rendering nothing.
 */
function presentationFor(type: string): Presentation {
  if (type.startsWith("SPACE_")) return { icon: Layers, tone: "neutral" };
  if (type.startsWith("PROJECT_")) return { icon: FolderKanban, tone: "brand" };
  if (type === "MATERIAL_UPLOADED") return { icon: FileUp, tone: "neutral" };
  if (type === "MATERIAL_READY") return { icon: FileCheck2, tone: "success" };
  if (type === "MATERIAL_FAILED") return { icon: AlertTriangle, tone: "danger" };
  if (type === "TUTOR_MESSAGE") return { icon: MessageSquare, tone: "brand" };
  if (type === "UNSUPPORTED_QUESTION") return { icon: ShieldAlert, tone: "warning" };
  if (type.startsWith("QUIZ_")) return { icon: ListChecks, tone: "brand" };
  if (type === "ANSWER_GRADED") return { icon: ListChecks, tone: "success" };
  if (type === "MASTERY_UPDATED") return { icon: TrendingUp, tone: "success" };
  if (type === "RECOMMENDATION_CREATED") return { icon: Lightbulb, tone: "brand" };
  if (type === "JOB_FAILED") return { icon: ServerCrash, tone: "danger" };

  return { icon: Lightbulb, tone: "neutral" };
}

/**
 * Renders the learning event log.
 *
 * The payload is shown when it carries a subject name, so an event survives the
 * deletion of the thing it refers to and still reads sensibly.
 */
export function ActivityFeed({
  items,
  emptyMessage = "No activity yet.",
}: {
  items: ActivityFeedItem[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-ink-subtle)]">{emptyMessage}</p>;
  }

  return (
    <ol className="flex flex-col">
      {items.map((item, index) => {
        const subject =
          item.payload && typeof item.payload === "object" && "name" in item.payload
            ? String((item.payload as { name: unknown }).name)
            : null;

        const { icon: Icon, tone } = presentationFor(item.type);

        return (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 py-3",
              index > 0 && "border-t border-[var(--color-border-subtle)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
                TONE_CLASSES[tone],
              )}
            >
              <Icon className="size-3.5" />
            </span>

            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span className="min-w-0 text-sm text-[var(--color-ink)]">
                {activityLabel(item.type)}
                {subject ? (
                  <span className="text-[var(--color-ink-muted)]"> · {subject}</span>
                ) : null}
              </span>

              <time
                dateTime={item.createdAt.toISOString()}
                className="shrink-0 text-xs text-[var(--color-ink-subtle)]"
              >
                {formatRelativeTime(item.createdAt)}
              </time>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
