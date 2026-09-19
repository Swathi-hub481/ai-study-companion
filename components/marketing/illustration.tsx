/**
 * Decorative artwork.
 *
 * Inline SVG rather than an image asset: it costs a few hundred bytes instead of a
 * few hundred kilobytes, needs no network request, inherits the theme through `currentColor`
 * and CSS variables, and stays crisp at every density. Both variants are `aria-hidden`
 * because they carry no information the surrounding text does not already state.
 */

/** Abstract "learning frontier" orb — the landing hero's companion. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 480 400"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="hero-orb" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="oklch(0.72 0.19 278)" stopOpacity="0.95" />
          <stop offset="55%" stopColor="oklch(0.6 0.2 275)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="oklch(0.5 0.18 270)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.8 0.13 215)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.66 0.19 285)" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="hero-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="oklch(0.6 0.2 275)" />
          <stop offset="100%" stopColor="oklch(0.8 0.13 215)" />
        </linearGradient>
      </defs>

      {/* Ambient bloom */}
      <circle cx="250" cy="176" r="168" fill="url(#hero-orb)" />

      {/* Orbit rings */}
      <ellipse
        cx="250"
        cy="176"
        rx="164"
        ry="164"
        stroke="url(#hero-ring)"
        strokeWidth="1"
        strokeDasharray="3 7"
      />
      <ellipse
        cx="250"
        cy="176"
        rx="122"
        ry="122"
        stroke="var(--color-border-strong)"
        strokeWidth="1"
        opacity="0.6"
      />

      {/* Orbiting nodes */}
      <circle cx="250" cy="12" r="5" fill="var(--color-accent)" />
      <circle cx="414" cy="176" r="4" fill="var(--color-brand-500)" />
      <circle cx="146" cy="262" r="3.5" fill="var(--color-success)" />

      {/* Floating progress panel */}
      <g transform="translate(96 232)">
        <rect
          width="188"
          height="104"
          rx="14"
          fill="var(--color-surface)"
          stroke="var(--color-border-subtle)"
        />
        <rect x="16" y="18" width="60" height="6" rx="3" fill="var(--color-ink-subtle)" />
        <rect x="16" y="34" width="96" height="6" rx="3" fill="var(--color-border-strong)" />

        <rect x="16" y="62" width="14" height="26" rx="4" fill="url(#hero-bar)" />
        <rect x="38" y="54" width="14" height="34" rx="4" fill="url(#hero-bar)" opacity="0.85" />
        <rect x="60" y="46" width="14" height="42" rx="4" fill="url(#hero-bar)" opacity="0.7" />
        <rect x="82" y="66" width="14" height="22" rx="4" fill="url(#hero-bar)" opacity="0.55" />

        <circle cx="156" cy="42" r="17" fill="var(--color-brand-50)" />
        <path
          d="M150 42.5l4 4 8.5-9"
          stroke="var(--color-brand-500)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Sparkles */}
      <path
        d="M92 96l4.5 11 11 4.5-11 4.5L92 127l-4.5-11-11-4.5 11-4.5L92 96z"
        fill="var(--color-accent)"
        opacity="0.75"
      />
      <path
        d="M392 74l3 7.5 7.5 3-7.5 3-3 7.5-3-7.5-7.5-3 7.5-3 3-7.5z"
        fill="var(--color-brand-500)"
        opacity="0.8"
      />
    </svg>
  );
}

/** Study-desk composition for the authentication brand panel. */
export function PanelArt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 200"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="panel-glow" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="oklch(0.62 0.2 275)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.5 0.18 270)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="160" cy="150" rx="150" ry="70" fill="url(#panel-glow)" />

      {/* Desk */}
      <rect x="44" y="150" width="232" height="6" rx="3" fill="var(--color-border-strong)" />

      {/* Laptop */}
      <path
        d="M108 150l10-52h84l10 52H108z"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.5"
      />
      <rect x="128" y="106" width="64" height="36" rx="4" fill="var(--color-surface-inset)" />
      <rect x="136" y="116" width="34" height="4" rx="2" fill="var(--color-brand-500)" />
      <rect x="136" y="126" width="48" height="4" rx="2" fill="var(--color-border-strong)" />

      {/* Book stack */}
      <rect x="22" y="132" width="62" height="8" rx="3" fill="var(--color-accent)" opacity="0.85" />
      <rect x="28" y="122" width="56" height="8" rx="3" fill="var(--color-success)" opacity="0.8" />
      <rect x="34" y="112" width="46" height="8" rx="3" fill="var(--color-brand-500)" opacity="0.9" />

      {/* Plant */}
      <path
        d="M256 150c-14 0-22-10-22-24 12 0 22 8 22 22"
        stroke="var(--color-success)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M256 150c0-16 8-24 20-26 0 14-8 24-20 26z"
        fill="var(--color-success)"
        opacity="0.55"
      />
      <path d="M246 150h20l-3 16h-14l-3-16z" fill="var(--color-warning)" opacity="0.85" />

      {/* Sparkles */}
      <path
        d="M270 62l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z"
        fill="var(--color-accent)"
        opacity="0.8"
      />
      <path
        d="M62 58l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5 2.5-6z"
        fill="var(--color-brand-500)"
        opacity="0.85"
      />
    </svg>
  );
}
