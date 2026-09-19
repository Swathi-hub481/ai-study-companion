"use client";

/**
 * Last-resort error boundary.
 *
 * `error.tsx` sits inside the root layout, so it cannot catch a failure *of* that layout.
 * This one replaces the whole document, which is why it renders its own `<html>` and
 * `<body>` — and why it uses inline styles rather than the app's Tailwind tokens, since
 * the stylesheet may be exactly what failed to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>

        <p style={{ maxWidth: "36rem", color: "#4b5563" }}>
          The application could not start this page. Nothing you have saved was lost.
        </p>

        {error.digest ? (
          <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>Reference: {error.digest}</p>
        ) : null}

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
