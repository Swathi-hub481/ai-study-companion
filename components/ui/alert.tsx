import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, { className: string; Icon: typeof Info }> = {
  info: {
    className: "border-[var(--color-info)]/30 bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
    Icon: Info,
  },
  success: {
    className:
      "border-[var(--color-success)]/30 bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
    Icon: CheckCircle2,
  },
  warning: {
    className:
      "border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
    Icon: AlertTriangle,
  },
  danger: {
    className:
      "border-[var(--color-danger)]/35 bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
    Icon: OctagonAlert,
  },
};

/**
 * Inline message.
 *
 * `role="alert"` is opt-in because an alert is announced immediately: form errors and
 * stream failures want it, a static explanatory note does not.
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const { className: toneClass, Icon } = TONES[tone];

  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        toneClass,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-[13px] leading-5 opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
