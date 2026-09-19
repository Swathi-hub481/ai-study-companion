import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth/page-guard";
import { getProjectDashboard } from "@/lib/services/projects";
import { listMaterials } from "@/lib/services/materials";
import { isAppError } from "@/lib/errors";
import { MaterialUploadForm } from "@/components/materials/upload-form";
import { MaterialList, type MaterialView } from "@/components/materials/material-list";
import { Alert } from "@/components/ui/alert";

type PageProps = { params: Promise<{ spaceId: string; projectId: string }> };

export const metadata: Metadata = { title: "Materials" };

/**
 * A Project's materials.
 *
 * The composition follows the reference: the heading with the upload action beside it,
 * then one panel holding the status tabs, the search and the rows. The upload control
 * *is* the header action — it opens the native file picker directly — so there is no
 * separate button that only scrolls to a form.
 */
export default async function MaterialsPage({ params }: PageProps) {
  const user = await requireUserPage();
  const { projectId } = await params;

  const dashboard = await getProjectDashboard(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  });

  const materials = await listMaterials(user.id, projectId);

  // Mapped to a plain shape here so the client component sees identical data whether
  // it arrives from the server or from the polling endpoint (where dates are strings).
  const views: MaterialView[] = materials.map((material) => ({
    id: material.id,
    filename: material.filename,
    sizeBytes: material.sizeBytes,
    status: material.status,
    error: material.error,
    pageCount: material.pageCount,
    createdAt: material.createdAt.toISOString(),
    chunkCount: material._count.chunks,
    conceptCount: material._count.concepts,
  }));

  const pending = views.some((view) => view.status === "QUEUED" || view.status === "PROCESSING");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Materials</h1>
          {/* Orientation: this page sits three levels deep, so it names its Project. */}
          <p className="truncate text-sm text-[var(--color-ink-muted)]">{dashboard.project.name}</p>
        </div>

        <MaterialUploadForm projectId={projectId} />
      </header>

      {pending ? (
        <Alert tone="info" role="status">
          Processing in the background. This page updates on its own — you can leave it.
        </Alert>
      ) : null}

      <MaterialList projectId={projectId} initialMaterials={views} />
    </div>
  );
}
