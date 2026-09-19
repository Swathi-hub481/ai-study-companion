"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  FileText,
  Home,
  Layers,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  MoreHorizontal,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/layout/user-menu";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

/**
 * Navigation is derived from the URL rather than passed down.
 *
 * A layout cannot read its descendant route params, but the pathname already contains
 * them — so the sidebar can offer the project sections (Tutor, Quiz, …) only while the
 * learner is actually inside a project, without a second data fetch in the shell.
 *
 * Those sections are *not* top-level routes: in this product a material library, a
 * tutor thread and an assessment all belong to one project, and inventing `/tutor`
 * or `/materials` links would point at pages that do not exist.
 */
function projectIdFrom(pathname: string): { spaceId: string; projectId: string } | null {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "spaces" || !segments[1]) return null;
  if (segments[2] !== "projects" || !segments[3]) return null;

  return { spaceId: segments[1], projectId: segments[3] };
}

function projectNav(spaceId: string, projectId: string): NavItem[] {
  const base = `/spaces/${spaceId}/projects/${projectId}`;

  return [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `${base}/materials`, label: "Materials", icon: FileText },
    { href: `${base}/tutor`, label: "Tutor", icon: MessageSquare },
    { href: `${base}/quiz`, label: "Quizzes", icon: ListChecks },
    { href: `${base}/growth`, label: "Growth", icon: TrendingUp },
    { href: `${base}/analytics`, label: "Analytics", icon: BarChart3 },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
          : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]/70 hover:text-[var(--color-ink)]",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 -left-2 w-1 rounded-full bg-gradient-to-b from-[var(--color-brand-400)] to-[var(--color-brand-600)] glow-brand"
        />
      ) : null}

      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          active
            ? "text-[var(--color-brand-500)]"
            : "text-[var(--color-ink-subtle)] group-hover:text-[var(--color-ink-muted)]",
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-2.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-[var(--color-ink-subtle)] uppercase">
        {label}
      </p>
      {items.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/home"
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-lg px-1 py-1"
      aria-label="AI Study Companion — home"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[0.6rem] bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-sm glow-brand"
      >
        <BookOpen className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className="truncate text-[13px] font-semibold tracking-tight">
          AI Study Companion
        </span>
        <span className="mt-1 truncate text-[10px] tracking-[0.08em] text-[var(--color-ink-subtle)] uppercase">
          Learn Smarter · Grow Faster
        </span>
      </span>
    </Link>
  );
}

function SidebarContent({
  pathname,
  user,
  onNavigate,
}: {
  pathname: string;
  user: { name: string; email: string; isAdmin: boolean };
  onNavigate: () => void;
}) {
  const project = projectIdFrom(pathname);

  return (
    <>
      <div className="px-3 pt-5 pb-4">
        <Brand onNavigate={onNavigate} />
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
        <NavGroup
          label="Learn"
          pathname={pathname}
          onNavigate={onNavigate}
          items={[
            { href: "/home", label: "Home", icon: Home, exact: true },
            { href: "/spaces", label: "Spaces", icon: Layers },
          ]}
        />

        {project ? (
          <NavGroup
            label="This project"
            pathname={pathname}
            onNavigate={onNavigate}
            items={projectNav(project.spaceId, project.projectId)}
          />
        ) : null}

        {user.isAdmin ? (
          <NavGroup
            label="Operations"
            pathname={pathname}
            onNavigate={onNavigate}
            items={[{ href: "/admin", label: "Admin", icon: ShieldCheck }]}
          />
        ) : null}
      </nav>

      <div className="border-t border-[var(--color-border-subtle)] p-2.5">
        <UserMenu name={user.name} email={user.email} isAdmin={user.isAdmin} placement="up" />
      </div>
    </>
  );
}

/**
 * Bottom navigation for phones.
 *
 * The reference's mobile screens carry a four-item bar. These are the four destinations
 * that genuinely exist: Home, Spaces, the Project you are currently inside — which appears
 * only when you are in one, mirroring how the sidebar grows a "This project" group — and
 * More, which opens the drawer holding everything else. The current item is marked with
 * `aria-current`, so the state is not carried by colour alone.
 */
function MobileNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const project = projectIdFrom(pathname);

  const items: NavItem[] = [
    { href: "/home", label: "Home", icon: Home, exact: true },
    { href: "/spaces", label: "Spaces", icon: Layers },
    ...(project
      ? [
          {
            href: `/spaces/${project.spaceId}/projects/${project.projectId}`,
            label: "Project",
            icon: LayoutDashboard,
            exact: true,
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border-subtle)] pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                  active
                    ? "text-[var(--color-brand-700)]"
                    : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink-muted)]",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={onMore}
            className="flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink-muted)]"
          >
            <MoreHorizontal aria-hidden="true" className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Authenticated shell.
 *
 * Desktop is a single persistent column: the sidebar carries the brand, the navigation
 * and the account, so no top bar is needed and nothing competes with the page's own
 * heading. Below `lg` that column becomes an off-canvas drawer behind a compact header,
 * because a shrunken desktop sidebar is not usable on a phone.
 */
export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A route change should always dismiss the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const close = () => setDrawerOpen(false);

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-lg focus:bg-[var(--color-brand-600)] focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-canvas-deep)]/85 lg:flex">
          <SidebarContent pathname={pathname} user={user} onNavigate={close} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="glass sticky top-0 z-30 border-b border-[var(--color-border-subtle)] lg:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                >
                  <Menu aria-hidden="true" className="size-4.5" />
                </button>

                <Brand />
              </div>

              <UserMenu
                name={user.name}
                email={user.email}
                isAdmin={user.isAdmin}
                placement="down"
              />
            </div>
          </header>

          {/*
            The bottom bar is fixed, so the content column reserves room for it — plus the
            home-indicator inset, so the last row of a page is never trapped under it.
          */}
          <main
            id="main-content"
            className="mx-auto w-full max-w-[84rem] flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8"
          >
            {children}
          </main>
        </div>
      </div>

      <MobileNav pathname={pathname} onMore={() => setDrawerOpen(true)} />

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={close}
            className="animate-fade-in absolute inset-0 bg-[oklch(0.1_0.02_265/0.7)] backdrop-blur-sm"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-rise absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-[var(--color-border-strong)] bg-[var(--color-canvas-deep)] shadow-lg"
          >
            <div className="flex items-center justify-between pr-3">
              <div className="px-3 pt-5 pb-4">
                <Brand onNavigate={close} />
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close navigation"
                className="flex size-8 items-center justify-center rounded-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <SidebarContent pathname={pathname} user={user} onNavigate={close} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
