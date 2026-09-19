"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutDashboard, ListChecks, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const LINKS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/activity", label: "Activity", icon: Activity },
  { href: "/admin/ai", label: "AI usage", icon: Sparkles },
  { href: "/admin/jobs", label: "Background jobs", icon: ListChecks },
];

/**
 * Sub-navigation for the admin area.
 *
 * A client component for one reason only: `usePathname()` is what lets the current
 * section be marked. It stays a plain-link nav — `aria-current`, a highlighted tab, and
 * nothing else — so behaviour is unchanged. The row scrolls horizontally rather than
 * wrapping, keeping it one scannable line on a phone.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1 shadow-xs">
        {LINKS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-[var(--color-brand-600)] text-white shadow-xs"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-white" : "text-[var(--color-ink-subtle)]",
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
