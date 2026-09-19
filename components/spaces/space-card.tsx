import Link from "next/link";
import { Layers } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A Space tile on the Spaces index.
 *
 * Follows the reference card: a coloured icon tile, the Space name, a single counts
 * line, and an explicit "View Space" action. The Space's own colour tints only the
 * icon — enough to tell two Spaces apart at a glance without turning the grid into a
 * colour wheel.
 */
export function SpaceCard({
  spaceId,
  name,
  color,
  projectCount,
  materialCount,
}: {
  spaceId: string;
  name: string;
  color: string | null;
  projectCount: number;
  materialCount: number;
}) {
  const accent = color ?? "var(--color-brand-500)";

  return (
    <article className="card flex h-full flex-col gap-4 p-5">
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl"
        style={{
          backgroundColor: `color-mix(in oklab, ${accent} 18%, transparent)`,
          color: accent,
        }}
      >
        <Layers className="size-5" />
      </span>

      <div className="flex flex-col gap-1">
        <h3 className="truncate text-base font-semibold tracking-tight">{name}</h3>
        <p className="text-xs text-[var(--color-ink-subtle)] tabular-nums">
          {projectCount} {projectCount === 1 ? "project" : "projects"} ·{" "}
          {materialCount} {materialCount === 1 ? "material" : "materials"}
        </p>
      </div>

      <Link
        href={`/spaces/${spaceId}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-auto w-full")}
      >
        View Space
      </Link>
    </article>
  );
}
