"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MoreVertical, RefreshCw, Trash2 } from "lucide-react";

/**
 * Per-material actions.
 *
 * A small menu rather than two always-visible buttons: the reference puts a single
 * three-dot control at the end of each row, and it keeps the row's information the
 * loudest thing in it. Escape closes it, a click outside closes it, and the trigger
 * carries an accessible name that includes the filename, because "Actions" repeated
 * down a list tells a screen-reader user nothing.
 */
export function MaterialActions({
  filename,
  canRetry,
  busy,
  onRetry,
  onDelete,
}: {
  filename: string;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${filename}`}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <MoreVertical aria-hidden="true" className="size-4" />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={`Actions for ${filename}`}
          className="animate-scale-in absolute top-full right-0 z-50 mt-1 w-48 origin-top-right overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] p-1.5 shadow-lg"
        >
          {canRetry ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRetry();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Retry processing
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--color-danger-ink)] transition-colors hover:bg-[var(--color-danger-soft)]"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
