/**
 * Circular progress ring.
 *
 * Server-rendered SVG, like the other charts in this folder: a ring is two circles and a
 * dash offset, so it costs no client JavaScript and stays crisp at any size.
 */
export function ProgressRing({
  /** 0..1 */
  value,
  label,
  size = 176,
  stroke = 12,
  colour = "var(--color-accent)",
  className,
}: {
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  colour?: string;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const centre = size / 2;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`${label}: ${percent}%`}
      className={className}
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="var(--color-surface-inset)"
        strokeWidth={stroke}
      />

      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke={colour}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${centre} ${centre})`}
      />

      <text
        x={centre}
        y={centre}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[var(--color-ink)]"
        style={{ fontSize: size * 0.2, fontWeight: 600 }}
      >
        {percent}%
      </text>
    </svg>
  );
}
