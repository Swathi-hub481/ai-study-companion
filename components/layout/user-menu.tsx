"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Account menu.
 *
 * Sits at the foot of the sidebar, so it opens *upwards* by default — a panel that
 * grew downwards there would fall off the bottom of the viewport. The email is shown
 * next to the name because a shared machine is exactly where "which account am I
 * signed in as?" matters.
 *
 * Sign-out deletes the server-side session row, so the token stops working even if it
 * was copied; the push afterwards is only navigation.
 */
export function UserMenu({
  name,
  email,
  isAdmin,
  placement = "down",
}: {
  name: string;
  email: string;
  isAdmin: boolean;
  /**
   * Which way the panel opens. The sidebar sits at the bottom of the viewport, so its
   * menu has to grow upwards; the mobile header sits at the top, so its menu grows down.
   */
  placement?: "up" | "down";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-muted)]/70"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-[11px] font-semibold text-white"
        >
          {initials || "?"}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-4 font-medium">{name}</span>
          <span className="truncate text-[11px] leading-4 text-[var(--color-ink-subtle)]">
            {isAdmin ? "Administrator" : "Learner"}
          </span>
        </span>

        <ChevronsUpDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-[var(--color-ink-subtle)]"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className={cn(
            "animate-scale-in absolute right-0 z-50 w-full min-w-56 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] shadow-lg",
            placement === "up"
              ? "bottom-full left-0 mb-2 origin-bottom-left"
              : "top-full mt-2 origin-top-right",
          )}
        >
          <div className="border-b border-[var(--color-border-subtle)] px-3.5 py-3">
            <p className="truncate text-[13px] font-medium">{name}</p>
            <p className="truncate text-xs text-[var(--color-ink-subtle)]">{email}</p>
          </div>

          <div className="p-1.5">
            {isAdmin ? (
              <Link
                role="menuitem"
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Admin console
              </Link>
            ) : null}

            <Link
              role="menuitem"
              href="/home"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
            >
              <LayoutDashboard aria-hidden="true" className="size-4" />
              Dashboard
            </Link>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={pending}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] disabled:opacity-60"
            >
              <LogOut aria-hidden="true" className="size-4" />
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
