import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  FileText,
  ListChecks,
  PlayCircle,
  Quote,
  TrendingUp,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { HeroArt } from "@/components/marketing/illustration";
import { cn } from "@/lib/utils";

/**
 * Public landing page.
 *
 * Signed-in visitors skip straight to the dashboard, so `/` doubles as the entry
 * point without a separate route. Everything claimed here maps to a capability that
 * actually exists in the product — the copy is deliberately specific rather than
 * generic AI marketing.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/home");
  }

  const features = [
    {
      icon: Quote,
      title: "Grounded answers",
      body: "Every Tutor answer links back to the page it came from, so you can check the claim instead of trusting it.",
      chip: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
    },
    {
      icon: FileText,
      title: "Your material, indexed",
      body: "Uploaded documents are parsed, chunked and embedded in the background — then become the syllabus.",
      chip: "border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
    },
    {
      icon: ListChecks,
      title: "Adaptive quizzes",
      body: "Questions are generated from your own documents, weakest concepts first, at a difficulty your mastery sets.",
      chip: "border-[var(--color-success)]/35 bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
    },
    {
      icon: TrendingUp,
      title: "Measurable growth",
      body: "Mastery is recomputed from your graded answers, and growth classifies every concept over time.",
      chip: "border-[var(--color-warning)]/35 bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
    },
  ];

  const loop = [
    { step: "Learn", body: "A space holds focused projects, each with a stated goal and its own documents." },
    { step: "Ask", body: "The Tutor answers only from those documents, and cites the page it used." },
    { step: "Practice", body: "Adaptive quizzes target your weakest concepts and match your difficulty." },
    { step: "Measure", body: "Every answer becomes evidence; mastery is computed from it, not from a score." },
    { step: "Improve", body: "Growth shows what is moving, and the dashboard states one concrete next action." },
  ];

  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How it works" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border-subtle)] glass">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-sm"
            >
              <BookOpen className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">AI Study Companion</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-lg px-3 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)]/70 hover:text-[var(--color-ink)] sm:inline-flex"
            >
              Sign in
            </Link>
            <Link href="/register" className={buttonVariants({ size: "sm" })}>
              Start Learning
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
          <div aria-hidden="true" className="grid-field absolute inset-0 opacity-40" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-24">
            <div className="flex flex-col gap-6">
              <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
                <span className="text-gradient-hero">Your AI-Powered</span>
                <br />
                Study Partner
              </h1>

              <p className="max-w-xl text-base leading-7 text-[var(--color-ink-muted)]">
                Upload your study materials, ask questions, take quizzes, track your progress and
                achieve your goals — all in one place.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link href="/register" className={buttonVariants({ size: "lg" })}>
                  Start Learning
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <a
                  href="#how-it-works"
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
                >
                  <PlayCircle aria-hidden="true" className="size-4" />
                  See how it works
                </a>
              </div>
            </div>

            <HeroArt className="mx-auto w-full max-w-lg" />
          </div>
        </section>

        {/* Feature cards */}
        <section
          id="features"
          className="scroll-mt-20 border-b border-[var(--color-border-subtle)]"
        >
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <article key={feature.title} className="card flex flex-col gap-3 p-5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg border",
                      feature.chip,
                    )}
                  >
                    <feature.icon className="size-4.5" />
                  </span>

                  <h2 className="text-sm font-semibold">{feature.title}</h2>
                  <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Learning loop */}
        <section id="how-it-works" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-[var(--color-brand-700)] uppercase">
                The learning loop
              </span>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">
                Five steps that keep their context from one to the next
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">
                Nothing is lost between them. The goal you wrote shapes the answers, the answers
                become evidence, and the evidence decides what you are asked next.
              </p>
            </div>

            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {loop.map((entry, index) => (
                <li key={entry.step} className="card flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-xs font-semibold text-[var(--color-brand-700)] tabular-nums"
                    >
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold">{entry.step}</h3>
                  <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-[var(--color-border-subtle)]">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <div className="card flex flex-col items-center gap-5 px-6 py-12 text-center">
              <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Start with one document and one honest question
              </h2>
              <p className="max-w-xl text-sm leading-6 text-[var(--color-ink-muted)]">
                Create a space, add a project with a goal, upload a PDF, and ask the Tutor something
                it can only answer from your material.
              </p>
              <Link href="/register" className={buttonVariants({ size: "lg" })}>
                Create your account
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border-subtle)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-md bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white"
            >
              <BookOpen className="size-3" />
            </span>
            <span className="text-[13px] text-[var(--color-ink-muted)]">AI Study Companion</span>
          </div>

          <p className="text-xs text-[var(--color-ink-subtle)]">
            Spaces · Projects · Grounded tutor · Adaptive assessment · Mastery · Growth
          </p>
        </div>
      </footer>
    </div>
  );
}
