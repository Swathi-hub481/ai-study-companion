import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status chip.
 *
 * Colour is paired with a label everywhere it is used, so state is never carried by
 * colour alone. Variants map to semantic tokens rather than raw hues, which is what
 * keeps a "Ready" chip and a "Completed" chip the same green.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral:
          "border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
        brand:
          "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
        success:
          "border-[var(--color-success)]/35 bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
        warning:
          "border-[var(--color-warning)]/35 bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
        danger:
          "border-[var(--color-danger)]/35 bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
        info: "border-[var(--color-info)]/35 bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
        accent:
          "border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
        outline: "border-[var(--color-border-strong)] text-[var(--color-ink-muted)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
