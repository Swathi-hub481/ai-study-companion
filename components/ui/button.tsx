import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button hierarchy.
 *
 * One primary action per view; everything else is secondary, outline, ghost or
 * destructive. The variants are the whole hierarchy — a page should never need to
 * hand-roll a button's colours, because that is how a product ends up with five
 * slightly different "main" buttons.
 *
 * On the dark surface the primary is a violet gradient with a faint halo rather
 * than a flat fill: it is the one element allowed to glow, which is what keeps it
 * unmistakably the primary action without enlarging it.
 *
 * Disabled is deliberately over-specified — dimmed, desaturated and stripped of its
 * halo — so an unavailable action is unmistakable at a glance while its label stays
 * legible. `disabled` is a real attribute, so the state is also announced.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,background-image] duration-150 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:saturate-50",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_1px_0_0_oklch(1_0_0/0.12)_inset,0_8px_20px_-10px_oklch(0.585_0.225_275/0.8)] hover:from-[var(--color-brand-400)] hover:to-[var(--color-brand-500)] hover:shadow-[0_1px_0_0_oklch(1_0_0/0.16)_inset,0_10px_28px_-10px_oklch(0.585_0.225_275/0.95)]",
        secondary:
          "border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-100)]",
        outline:
          "border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]/50 text-[var(--color-ink)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-surface-muted)]",
        ghost:
          "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]",
        destructive:
          "border border-[var(--color-danger)]/45 bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)] hover:border-[var(--color-danger)]/70 hover:bg-[var(--color-danger)]/20",
        link: "text-[var(--color-brand-700)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
