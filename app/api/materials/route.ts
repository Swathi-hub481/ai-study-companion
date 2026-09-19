import { created, ok, parseQuery, route } from "@/lib/http";
import { requireUser } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { enforcePolicy, RATE_LIMITS } from "@/lib/rate-limit";
import { createMaterial, listMaterials } from "@/lib/services/materials";
import { z } from "zod";

export const dynamic = "force-dynamic";
// PDF parsing and OCR need Node APIs, not the edge runtime.
export const runtime = "nodejs";

const listQuery = z.object({ projectId: z.string().min(1, "projectId is required.") });

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser();
    const { projectId } = parseQuery(request, listQuery);

    return ok({ materials: await listMaterials(user.id, projectId) });
  });
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser();

    // Uploads are expensive downstream (parsing, OCR, embedding), so they are limited
    // before any of that work is queued.
    enforcePolicy(`material-upload:${user.id}`, RATE_LIMITS.materialUpload);

    const formData = await request.formData();
    const projectId = formData.get("projectId");
    const file = formData.get("file");

    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new ValidationError("A projectId is required.");
    }

    if (!(file instanceof File)) {
      throw new ValidationError("A file is required.");
    }

    const material = await createMaterial(user.id, projectId, {
      filename: file.name || "document.pdf",
      declaredMimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });

    // 202: the row exists and is queueed, but the document is not usable yet.
    return created({ material });
  });
}
