import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formats a 0..1 ratio as a whole percentage. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, secondsPerUnit] of units) {
    const amount = Math.floor(seconds / secondsPerUnit);
    if (amount >= 1) return formatter.format(-amount, unit);
  }

  return "just now";
}

/** Buckets a mastery estimate into the three growth bands used across the UI. */
export function masteryBand(mastery: number): "low" | "mid" | "high" {
  if (mastery < 0.5) return "low";
  if (mastery < 0.75) return "mid";
  return "high";
}

/**
 * A USD figure that stays readable at both ends.
 *
 * Model calls are fractions of a cent, so the usual two-decimal format would render most
 * rows as "$0.00" and make the column useless.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-GB")}`;
}

/** Compact counts for dashboards: 1.2k, 3.4M. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";

  const magnitude = Math.abs(value);
  if (magnitude < 1000) return String(Math.round(value));
  if (magnitude < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
