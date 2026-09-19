import Link from "next/link";
import { BookOpen, FileText } from "lucide-react";
import type { Citation } from "@/lib/learning/tutor";

/**
 * The sources behind an answer.
 *
 * Citations are retrieved evidence, not model output, so every chip points at a real
 * document and page. Where a per-document viewer exists this should deep-link into it;
 * for now it leads to the Project's Materials page.
 *
 * Rendered as a distinct "Sources" block so evidence reads as first-class rather than as
 * an afterthought tacked onto the answer text.
 */
export function CitationList({
  citations,
  materialsHref,
}: {
  citations: Citation[];
  materialsHref: string;
}) {
  if (citations.length === 0) return null;

  return (
    <section
      aria-label="Sources"
      className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)] uppercase">
        <BookOpen aria-hidden="true" className="size-3.5 text-[var(--color-brand-500)]" />
        Sources
      </p>

      <ul className="flex flex-wrap gap-2">
        {citations.map((citation) => (
          <li key={`${citation.materialId}:${citation.page ?? "none"}`} className="min-w-0">
            <Link
              href={materialsHref}
              title={`Similarity ${citation.score}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-700)]"
            >
              <FileText aria-hidden="true" className="size-3.5 shrink-0 text-[var(--color-brand-500)]" />
              <span className="min-w-0 truncate font-medium">{citation.title}</span>
              <span aria-hidden="true" className="opacity-60">
                ·
              </span>
              <span className="shrink-0 tabular-nums">
                {citation.page ? `p. ${citation.page}` : "page unknown"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
