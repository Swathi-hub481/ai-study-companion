import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Study Companion",
    template: "%s · AI Study Companion",
  },
  description:
    "A persistent, contextual, measurable AI learning companion: spaces, projects, materials, grounded tutoring, adaptive assessment, mastery, and growth.",
};

export const viewport: Viewport = {
  // The product is dark-first, so the browser chrome (and mobile address bar) matches
  // the canvas rather than flashing white before the stylesheet lands.
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0f172a" }],
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
