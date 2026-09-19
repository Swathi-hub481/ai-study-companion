import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { listActivity, listFilterOptions } from "@/lib/services/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { ACTIVITY_LABELS, activityLabel } from "@/lib/analytics/activity-types";
import { cn, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Activity" };

type PageProps = {
  searchParams: Promise<{
    userId?: string;
    projectId?: string;
    type?: string;
    days?: string;
    page?: string;
  }>;
};

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const PAGE_SIZE = 25;

export default async function AdminActivityPage({ searchParams }: PageProps) {
  const admin = await requireAdminPage();
  const filters = await searchParams;

  const days = Number(filters.days);
  const page = Number(filters.page);

  const [options, result] = await Promise.all([
    listFilterOptions(admin),
    listActivity(admin, {
      userId: filters.userId,
      projectId: filters.projectId,
      type: filters.type,
      since:
        Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86_400_000) : undefined,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const queryString = (nextPage: number) => {
    const params = new URLSearchParams();
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.type) params.set("type", filters.type);
    if (filters.days) params.set("days", filters.days);
    params.set("page", String(nextPage));
    return `/admin/activity?${params.toString()}`;
  };

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <PageHeader
        title="Activity feed"
        description={`${result.total} event${result.total === 1 ? "" : "s"} match the current filter.`}
      />

      <AdminNav />

      <Section
        title="Filters"
        description="Every control maps to a query parameter, so the current view is bookmarkable."
      >
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="User" htmlFor="userId" className="w-full sm:w-56">
            <Select id="userId" name="userId" defaultValue={filters.userId ?? ""}>
              <option value="">Anyone</option>
              {options.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Project" htmlFor="projectId" className="w-full sm:w-56">
            <Select id="projectId" name="projectId" defaultValue={filters.projectId ?? ""}>
              <option value="">Any project</option>
              {options.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.spaceName} / {project.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Event type" htmlFor="type" className="w-full sm:w-56">
            <Select id="type" name="type" defaultValue={filters.type ?? ""}>
              <option value="">Any type</option>
              {Object.keys(ACTIVITY_LABELS).map((type) => (
                <option key={type} value={type}>
                  {activityLabel(type)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Range" htmlFor="days" className="w-full sm:w-44">
            <Select id="days" name="days" defaultValue={filters.days ?? ""}>
              <option value="">All time</option>
              {RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit">Apply</Button>

          <Link
            href="/admin/activity"
            className="inline-flex h-10 items-center text-sm text-[var(--color-ink-subtle)] underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            Clear
          </Link>
        </form>
      </Section>

      <Section title="Events">
        {result.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing matched those filters"
            body="Widen the range or clear a filter to see more activity."
          />
        ) : (
          <ol className="flex flex-col">
            {result.items.map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3",
                  index > 0 && "border-t border-[var(--color-border-subtle)]",
                )}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-[var(--color-ink)]">
                    {activityLabel(item.type)}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    <Link
                      href={`/admin/users/${item.userId}`}
                      className="rounded font-medium hover:text-[var(--color-brand-600)] hover:underline"
                    >
                      {item.userName}
                    </Link>
                    <span className="text-[var(--color-ink-subtle)]"> · {item.userEmail}</span>
                  </span>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-subtle)]">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Link
                  href={queryString(result.page - 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  Previous
                </Link>
              ) : (
                <span />
              )}
            </div>

            <span className="text-xs tabular-nums text-[var(--color-ink-subtle)]">
              Page {result.page} of {totalPages}
            </span>

            <div className="flex items-center gap-2">
              {result.page < totalPages ? (
                <Link
                  href={queryString(result.page + 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Next
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              ) : (
                <span />
              )}
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
