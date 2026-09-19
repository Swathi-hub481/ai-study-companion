import { cn } from "@/lib/utils";

/**
 * Form controls.
 *
 * A dark field on a darker inset, with a hairline border that brightens on hover and
 * a violet ring on focus. The ring is a real `ring` rather than the global outline so
 * a focused control stays legible when it sits on a violet-tinted card.
 */
const FIELD_BASE =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-inset)] text-sm text-[var(--color-ink)] shadow-xs transition-[border-color,box-shadow,background-color] placeholder:text-[var(--color-ink-subtle)] hover:border-[var(--color-ink-subtle)]/60 focus:border-[var(--color-brand-500)] focus:bg-[var(--color-surface-inset)] focus:ring-4 focus:ring-[var(--color-brand-500)]/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-[var(--color-danger)]/20";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(FIELD_BASE, "h-10 px-3", className)} {...props} />;
}

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn(FIELD_BASE, "resize-y px-3 py-2", className)} {...props} />;
}

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn(FIELD_BASE, "h-10 px-3", className)} {...props} />;
}
