import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Login / Sign Up switch.
 *
 * Rendered as two links rather than a stateful tab widget: sign-in and sign-up are
 * separate routes with separate forms, so navigating between them is what actually
 * changes the page — a client-side tab that swapped a form would be theatre. The
 * active one carries `aria-current`, which is the correct signal for a link that
 * represents "you are here".
 */
export function AuthTabs({ active }: { active: "login" | "register" }) {
  const tabs = [
    { key: "login" as const, label: "Login", href: "/login" },
    { key: "register" as const, label: "Sign Up", href: "/register" },
  ];

  return (
    <div className="flex gap-6 border-b border-[var(--color-border-subtle)]">
      {tabs.map((tab) => {
        const isActive = tab.key === active;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-[var(--color-brand-600)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-ink-subtle)] hover:text-[var(--color-ink-muted)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
