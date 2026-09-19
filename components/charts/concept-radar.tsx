import { MasteryBar } from "@/components/mastery-bar";
import { masteryBand } from "@/lib/utils";

/**
 * Mastery across a project's concepts, drawn as a radar.
 *
 * A radar makes the *shape* of someone's knowledge legible — a spiky polygon with one
 * weak spoke reads differently from a small even one, which a list of bars hides.
 *
 * Server-rendered SVG, no client JavaScript. Fewer than three axes is not a radar, so it
 * degrades to a plain bar list instead of drawing a degenerate shape.
 */

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 78;
/** How far beyond the outer ring a label sits. */
const LABEL_GAP = 16;
/** Padding inside the viewBox so edge labels are never clipped. */
const PAD_X = 72;
const PAD_Y = 30;
const RINGS = [0.25, 0.5, 0.75, 1];
const MAX_AXES = 8;

const BAND_COLOURS = {
  low: "var(--color-mastery-low)",
  mid: "var(--color-mastery-mid)",
  high: "var(--color-mastery-high)",
} as const;

function pointAt(index: number, count: number, scale: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return {
    x: CENTER + Math.cos(angle) * RADIUS * scale,
    y: CENTER + Math.sin(angle) * RADIUS * scale,
    labelX: CENTER + Math.cos(angle) * (RADIUS + LABEL_GAP),
    labelY: CENTER + Math.sin(angle) * (RADIUS + LABEL_GAP),
  };
}

export function ConceptRadar({
  concepts,
  label = "Concept mastery",
}: {
  concepts: Array<{ name: string; mastery: number }>;
  label?: string;
}) {
  const axes = concepts.slice(0, MAX_AXES);

  if (axes.length < 3) {
    return (
      <div className="flex w-full flex-col gap-3">
        <p className="text-sm text-[var(--color-ink-subtle)]">
          A radar needs at least three concepts — this project has {axes.length}. Showing them as
          bars instead.
        </p>
        <ul className="flex flex-col gap-3">
          {concepts.map((concept) => (
            <li key={concept.name}>
              <MasteryBar value={concept.mastery} label={concept.name} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const average = axes.reduce((total, concept) => total + concept.mastery, 0) / axes.length;

  const outline = axes
    .map((concept, index) => {
      const mastery = Math.min(1, Math.max(0, concept.mastery));
      const point = pointAt(index, axes.length, mastery);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`${-PAD_X} ${-PAD_Y} ${SIZE + PAD_X * 2} ${SIZE + PAD_Y * 2}`}
      role="img"
      aria-label={`${label}: ${axes
        .map((concept) => `${concept.name} ${Math.round(concept.mastery * 100)}%`)
        .join(", ")}`}
      className="h-auto w-full max-w-[22rem] shrink-0"
      preserveAspectRatio="xMidYMid meet"
    >
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={axes
            .map((_, index) => {
              const point = pointAt(index, axes.length, ring);
              return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={ring === 1 ? "var(--color-border-strong)" : "var(--color-border-subtle)"}
          strokeWidth={1}
        />
      ))}

      {axes.map((_, index) => {
        const point = pointAt(index, axes.length, 1);
        return (
          <line
            key={`axis-${index}`}
            x1={CENTER}
            y1={CENTER}
            x2={point.x}
            y2={point.y}
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
          />
        );
      })}

      <polygon
        points={outline}
        fill="var(--color-brand-500)"
        fillOpacity={0.22}
        stroke="var(--color-brand-600)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {axes.map((concept, index) => {
        const point = pointAt(index, axes.length, 1);
        const anchor =
          point.labelX > CENTER + 8 ? "start" : point.labelX < CENTER - 8 ? "end" : "middle";

        return (
          <text
            key={concept.name}
            x={point.labelX}
            y={point.labelY}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-[var(--color-ink-muted)]"
            style={{ fontSize: 9.5 }}
          >
            {concept.name.length > 16 ? `${concept.name.slice(0, 15)}…` : concept.name}
          </text>
        );
      })}

      <circle cx={CENTER} cy={CENTER} r={3} fill={BAND_COLOURS[masteryBand(average)]} />
    </svg>
  );
}
