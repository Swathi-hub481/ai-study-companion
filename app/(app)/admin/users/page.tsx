import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/page-guard";
import { listUsers } from "@/lib/services/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Users" };

type PageProps = { searchParams: Promise<{ query?: string; page?: string }> };

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const user = await requireAdminPage();
  const { query, page } = await searchParams;

  const parsedPage = Number(page);
  const result = await listUsers(user, {
    query,
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <PageHeader
        title="Users"
        description={`${result.total} account${result.total === 1 ? "" : "s"}. Open one to trace its learning journey.`}
      />

      <AdminNav />

      <Section title="Search" description="Filter accounts by name or email address.">
        {/* A plain GET form: the filter lives in the URL, so the page stays a server component. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Name or email" htmlFor="query" className="w-full sm:w-72">
            <Input
              id="query"
              name="query"
              defaultValue={query ?? ""}
              placeholder="e.g. learner@example.com"
            />
          </Field>

          <Button type="submit">Search</Button>

          {query ? (
            <Link
              href="/admin/users"
              className="inline-flex h-10 items-center text-sm text-[var(--color-ink-subtle)] underline underline-offset-4 hover:text-[var(--color-ink)]"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </Section>

      <Section title="Accounts">
        {result.users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users matched that search"
            body="Try a different name or email, or clear the search to see every account."
          >
            {query ? (
              <Link
                href="/admin/users"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Clear search
              </Link>
            ) : null}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              {/* The caption is the table's accessible name; without one a screen reader
                  announces "table" with no indication of what it contains. */}
              <caption className="sr-only">Accounts, with their role and learning totals</caption>
              <thead>
                <tr className="text-left text-xs tracking-wide text-[var(--color-ink-subtle)] uppercase">
                  <th scope="col" className="py-2.5 pr-4 font-medium">
                    User
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">
                    Role
                  </th>
                  <th scope="col" className="hidden py-2.5 pr-4 font-medium lg:table-cell">
                    Spaces
                  </th>
                  <th scope="col" className="hidden py-2.5 pr-4 font-medium lg:table-cell">
                    Projects
                  </th>
                  <th scope="col" className="hidden py-2.5 pr-4 font-medium lg:table-cell">
                    Materials
                  </th>
                  <th scope="col" className="hidden py-2.5 pr-4 font-medium lg:table-cell">
                    Concepts
                  </th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-medium">
                    AI calls
                  </th>
                  <th scope="col" className="hidden py-2.5 font-medium sm:table-cell">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((entry) => (
                  <tr
                    key={entry.id}
                    className="transition-colors hover:bg-[var(--color-surface-muted)]/50"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/users/${entry.id}`}
                        className="font-medium text-[var(--color-ink)] hover:text-[var(--color-brand-600)] hover:underline"
                      >
                        {entry.name}
                      </Link>
                      <span className="block text-xs text-[var(--color-ink-subtle)]">
                        {entry.email}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={entry.role === "ADMIN" ? "brand" : "neutral"}>
                        {entry.role.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="hidden py-3 pr-4 tabular-nums lg:table-cell">{entry.spaces}</td>
                    <td className="hidden py-3 pr-4 tabular-nums lg:table-cell">
                      {entry.projects}
                    </td>
                    <td className="hidden py-3 pr-4 tabular-nums lg:table-cell">
                      {entry.materials}
                    </td>
                    <td className="hidden py-3 pr-4 tabular-nums lg:table-cell">
                      {entry.concepts}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{entry.aiCalls}</td>
                    <td className="hidden py-3 whitespace-nowrap text-[var(--color-ink-subtle)] sm:table-cell">
                      {entry.lastActivityAt ? formatRelativeTime(entry.lastActivityAt) : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Link
                  href={`/admin/users?page=${result.page - 1}${query ? `&query=${encodeURIComponent(query)}` : ""}`}
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
                  href={`/admin/users?page=${result.page + 1}${query ? `&query=${encodeURIComponent(query)}` : ""}`}
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
