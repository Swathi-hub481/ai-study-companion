import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderKanban, Layers } from "lucide-react";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getSpaceDashboard } from "@/lib/services/spaces";
import { isAppError } from "@/lib/errors";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/empty-state";

type PageProps = { params: Promise<{ spaceId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { spaceId } = await params;
  const user = await requireUserPage();

  try {
    const dashboard = await getSpaceDashboard(user.id, spaceId);
    return { title: dashboard.space.name };
  } catch {
    return { title: "Space" };
  }
}

/**
 * A Space and its Projects.
 *
 * The composition follows the reference: a space header carrying the icon, name and
 * roll-up counts, the create action, then one full-width row per Project. The counts are
 * in the header rather than in separate statistic tiles, because tiles repeating the
 * two numbers directly above them was pure duplication.
 */
export default async function SpacePage({ params }: PageProps) {
  const user = await requireUserPage();
  const { spaceId } = await params;

  // A Space that does not exist and a Space belonging to someone else are
  // deliberately indistinguishable — see lib/auth/guards.ts.
  const dashboard = await getSpaceDashboard(user.id, spaceId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const { space, projects, totals } = dashboard;
  const accent = space.color ?? "var(--color-brand-500)";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: `color-mix(in oklab, ${accent} 20%, transparent)`,
              color: accent,
            }}
          >
            <Layers className="size-5.5" />
          </span>

          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{space.name}</h1>
            <p className="text-sm text-[var(--color-ink-muted)] tabular-nums">
              {totals.projects} {totals.projects === 1 ? "project" : "projects"} ·{" "}
              {totals.materials} {totals.materials === 1 ? "material" : "materials"}
            </p>
          </div>
        </div>

        <CreateProjectForm spaceId={space.id} defaultOpen={projects.length === 0} />
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          body="A project is a focused learning journey with its own goal, materials, and progress. Create one to start adding documents."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map(({ project, mastery, materialCount, failedMaterials }) => (
            <li key={project.id}>
              <ProjectCard
                spaceId={space.id}
                projectId={project.id}
                name={project.name}
                description={project.description}
                mastery={mastery.averageMastery}
                updatedAt={project.updatedAt}
                materialCount={materialCount}
                failedMaterials={failedMaterials}
                accent={accent}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
