import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ListChecks, MessageSquare, Sparkles, TrendingUp } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { PanelArt } from "@/components/marketing/illustration";

/**
 * Auth route group.
 *
 * Already-signed-in users are sent to the dashboard rather than shown a sign-in form
 * they do not need.
 *
 * The composition follows the reference: a dark branded panel beside a *light* card.
 * The card is the only light surface in the product, which is exactly why it earns
 * `paper-surface` — it re-declares the theme tokens for its subtree, so the shared
 * `Field`, `Input` and `Alert` components render light inside it with no forked copies.
 * The brand panel is desktop-only; on a phone it would push the form below the fold.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/home");
  }

  const pillars = [
    { icon: Sparkles, label: "Personalized Learning" },
    { icon: MessageSquare, label: "AI-Powered Tutor" },
    { icon: ListChecks, label: "Smart Assessments" },
    { icon: TrendingUp, label: "Track Your Growth" },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--color-border-subtle)] bg-[var(--color-canvas-deep)] p-10 lg:flex">
        <div aria-hidden="true" className="grid-field absolute inset-0 opacity-50" />

        <div className="relative flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-sm glow-brand"
          >
            <BookOpen className="size-5" />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight">AI Study Companion</span>
            <span className="text-[12px] text-[var(--color-brand-700)]">
              Learn Smarter · Grow Faster
            </span>
          </span>
        </div>

        <div className="relative flex flex-col gap-7">
          <h2 className="max-w-sm text-3xl leading-tight font-semibold tracking-tight text-balance">
            Study your own material, and see what actually stuck.
          </h2>

          <ul className="flex flex-col gap-4">
            {pillars.map((pillar) => (
              <li key={pillar.label} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                >
                  <pillar.icon className="size-4" />
                </span>
                <span className="text-sm font-medium text-[var(--color-ink-muted)]">
                  {pillar.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <PanelArt className="relative w-full max-w-sm" />
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="flex w-full max-w-md flex-col gap-6">
          {/* The brand mark stands in for the panel on small screens. */}
          <Link href="/" className="flex items-center gap-2.5 lg:hidden">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white"
            >
              <BookOpen className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">AI Study Companion</span>
          </Link>

          <div className="paper-surface shadow-paper rounded-2xl p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
