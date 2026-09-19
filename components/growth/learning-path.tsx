import { Badge } from "@/components/ui/badge";
import { MasteryTrend } from "@/components/charts/mastery-trend";
import { GROWTH_BAND_LABELS, type ConceptGrowth, type GrowthBand } from "@/lib/learning/growth";

const BAND_TONE: Record<GrowthBand, "danger" | "success" | "neutral"> = {
  NEEDS_ATTENTION: "danger",
  IMPROVING: "success",
  STABLE: "neutral",
};

/**
 * The learner's concepts as an ordered path.
 *
 * The order and the status both come from `classifyGrowth` — this component groups and
 * renders nothing on its own. A view that classified concepts itself would be free to
 * disagree with the recommendation engine about the same learner.
 *
 * The concepts are passed in already ordered by band, so the path reads weakest-first and
 * the numbering matches the order on screen.
 */
export function LearningPath({ concepts }: { concepts: ConceptGrowth[] }) {
  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Learning Path</h2>
        <Badge variant="neutral">
          {concepts.length} concept{concepts.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <ol className="flex flex-col">
        {concepts.map((concept, index) => {
          const deltaPoints = Math.round(concept.delta * 100);
          const improving = concept.delta > 0;

          return (
            <li
              key={concept.conceptId}
              className="flex items-center gap-3.5 py-3.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border-subtle)]"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-xs font-semibold text-[var(--color-ink-muted)] tabular-nums"
              >
                {index + 1}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-sm font-medium">{concept.name}</span>

                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--color-ink-subtle)]">
                  <span className="tabular-nums">
                    {concept.evidenceCount} observation{concept.evidenceCount === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden="true">·</span>
                  {concept.delta === 0 ? (
                    <span>no change</span>
                  ) : (
                    <span
                      className="font-medium tabular-nums"
                      style={{
                        color: improving ? "var(--color-mastery-high)" : "var(--color-mastery-low)",
                      }}
                    >
                      {improving ? "+" : ""}
                      {deltaPoints} points
                    </span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{Math.round(concept.mastery * 100)}% mastery</span>
                </span>
              </div>

              <div className="hidden shrink-0 sm:block">
                <MasteryTrend series={concept.series} label={concept.name} />
              </div>

              <Badge variant={BAND_TONE[concept.band]} className="shrink-0">
                {GROWTH_BAND_LABELS[concept.band]}
              </Badge>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
