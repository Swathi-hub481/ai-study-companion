import { noContent, ok, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { deleteMaterial, getMaterial, retryMaterial } from "@/lib/services/materials";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ materialId: string }> };

/**
 * Material status.
 *
 * Includes the queue position of the processing job so the UI can distinguish
 * "waiting for a worker" from "actively being processed" — the two look identical
 * from the material row alone.
 */
export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { materialId } = await context.params;

    const material = await getMaterial(user.id, materialId);

    const [counts, job] = await Promise.all([
      prisma.chunk.aggregate({
        where: { materialId: material.id },
        _count: { _all: true },
        _avg: { tokenCount: true },
      }),
      prisma.job.findUnique({
        where: { idempotencyKey: `material:${material.id}:process` },
        select: { status: true, attempts: true, maxAttempts: true, lastError: true },
      }),
    ]);

    return ok({
      material,
      processing: {
        chunkCount: counts._count._all,
        averageChunkTokens: Math.round(counts._avg.tokenCount ?? 0),
        job,
      },
    });
  });
}

/** Re-queues a material for processing. */
export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { materialId } = await context.params;

    return ok({ material: await retryMaterial(user.id, materialId) });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser();
    const { materialId } = await context.params;

    await deleteMaterial(user.id, materialId);
    return noContent();
  });
}
