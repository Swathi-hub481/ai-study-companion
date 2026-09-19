import { randomUUID } from "node:crypto";
import { MaterialStatus, type Material } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db";
import { assertMaterialAccess, assertProjectAccess } from "@/lib/auth/guards";
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  DocumentProcessingError,
} from "@/lib/errors";
import { ActivityType, recordActivity } from "@/lib/analytics/events";
import { logger } from "@/lib/logger";
import { getStorage, materialStorageKey } from "@/lib/storage";
import { extractPdfPages, needsOcr } from "@/lib/documents/parse";
import { mergeOcrResults, recognisePages, selectPagesForOcr } from "@/lib/documents/ocr";
import { chunkPages } from "@/lib/documents/chunk";
import { extractConcepts } from "@/lib/ai/features/extract-concepts";
import { replaceChunks } from "@/lib/rag/embed";
import { JobType } from "@prisma/client";
import { enqueueJob, requeueJob } from "@/lib/jobs/queue";

/**
 * Materials — upload, and the asynchronous pipeline that turns a document into
 * searchable knowledge.
 *
 * The pipeline is idempotent end to end: chunks are replaced rather than appended,
 * and concepts are upserted, so a retried job converges on the same result instead of
 * duplicating it.
 */

export const MATERIAL_JOB_IDS = {
  process: (materialId: string) => `material:${materialId}:process`,
};

const ALLOWED_MIME_TYPES = new Set(["application/pdf"]);

/**
 * Below this much extracted text, a document is treated as having no usable content.
 *
 * A genuinely scanned PDF yields nearly nothing from the text layer, and a document
 * that reports READY with zero chunks would look successful while being useless to
 * the Tutor. Better to fail with a reason the user can act on.
 */
const MIN_USABLE_TEXT_CHARACTERS = 40;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type MaterialUpload = {
  filename: string;
  declaredMimeType: string;
  data: Buffer;
};

export async function createMaterial(
  userId: string,
  projectId: string,
  upload: MaterialUpload,
): Promise<Material> {
  const project = await assertProjectAccess(userId, projectId);

  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (upload.data.length > maxBytes) {
    throw new PayloadTooLargeError(
      `That file is ${(upload.data.length / 1024 / 1024).toFixed(1)}MB. The limit is ${env.MAX_UPLOAD_MB}MB.`,
    );
  }

  if (upload.data.length === 0) {
    throw new UnsupportedMediaTypeError("That file is empty.");
  }

  // Sniff the real type. The browser-supplied Content-Type is attacker-controlled and
  // a `.pdf` extension proves nothing.
  //
  // Detection failing is a rejection, not a reason to trust the declared type: a
  // fallback there would let anyone bypass the check by claiming "application/pdf".
  const detected = await fileTypeFromBuffer(upload.data);

  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new UnsupportedMediaTypeError(
      `Only PDF documents are supported. That file appears to be ${detected?.ext ?? "an unrecognised format"}.`,
    );
  }

  if (upload.declaredMimeType && upload.declaredMimeType !== detected.mime) {
    // Worth knowing about: a mismatch is either a misconfigured client or an attempt
    // to get something past the sniffer.
    logger.warn(
      {
        projectId,
        declared: upload.declaredMimeType,
        detected: detected.mime,
        filename: upload.filename,
      },
      "Uploaded file's declared type does not match its contents",
    );
  }

  const mimeType = detected.mime;

  // The id is generated here rather than by the database so the storage key can be
  // derived before the row exists, keeping this to a single write.
  const materialId = randomUUID();
  const storageKey = materialStorageKey(projectId, materialId, detected?.ext ?? "pdf");

  await getStorage().put(storageKey, upload.data);

  const material = await prisma.$transaction(async (tx) => {
    const created = await tx.material.create({
      data: {
        id: materialId,
        projectId,
        filename: sanitiseFilename(upload.filename),
        mimeType,
        sizeBytes: upload.data.length,
        storageKey,
        status: MaterialStatus.QUEUED,
      },
    });

    await recordActivity(tx, {
      userId,
      type: ActivityType.MATERIAL_UPLOADED,
      spaceId: project.spaceId,
      projectId,
      payload: { name: created.filename },
    });

    return created;
  });

  await enqueueJob({
    type: JobType.MATERIAL_PROCESS,
    payload: { materialId },
    idempotencyKey: MATERIAL_JOB_IDS.process(materialId),
  });

  return material;
}

/** Strips path separators and control characters from a user-supplied filename. */
export function sanitiseFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  return (cleaned || "document.pdf").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMaterials(userId: string, projectId: string) {
  const project = await assertProjectAccess(userId, projectId);

  return prisma.material.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true, concepts: true } } },
  });
}

export async function getMaterial(userId: string, materialId: string) {
  return assertMaterialAccess(userId, materialId);
}

/** Re-queues a material for processing, resetting the existing job if there is one. */
export async function retryMaterial(userId: string, materialId: string): Promise<Material> {
  const material = await assertMaterialAccess(userId, materialId);

  await prisma.material.update({
    where: { id: material.id },
    data: { status: MaterialStatus.QUEUED, error: null },
  });

  const key = MATERIAL_JOB_IDS.process(material.id);

  // Resetting the existing row keeps one job per material, so a retry cannot leave
  // the queue holding several copies of the same work.
  const reused = await requeueJob(key, { resetAttempts: true });

  if (!reused) {
    await enqueueJob({
      type: JobType.MATERIAL_PROCESS,
      payload: { materialId: material.id },
      idempotencyKey: key,
    });
  }

  return { ...material, status: MaterialStatus.QUEUED, error: null };
}

export async function deleteMaterial(userId: string, materialId: string): Promise<void> {
  const material = await assertMaterialAccess(userId, materialId);

  // Remove the stored file first: if that fails, the row remains and the user can
  // retry, rather than ending up with a database record pointing at nothing.
  await getStorage().delete(material.storageKey);

  await prisma.$transaction(async (tx) => {
    await tx.material.delete({ where: { id: material.id } });
    await tx.job.deleteMany({ where: { idempotencyKey: MATERIAL_JOB_IDS.process(material.id) } });
  });
}

// ---------------------------------------------------------------------------
// Processing pipeline
// ---------------------------------------------------------------------------

export type ProcessMaterialResult = {
  materialId: string;
  pageCount: number;
  chunkCount: number;
  conceptCount: number;
  ocrPages: number[];
};

export async function processMaterial(materialId: string): Promise<ProcessMaterialResult> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    include: { project: { select: { id: true, spaceId: true, space: { select: { userId: true } } } } },
  });

  if (!material) {
    // The material was deleted while the job was queued; there is nothing to do and
    // retrying would never succeed.
    throw new DocumentProcessingError("The material no longer exists.");
  }

  const userId = material.project.space.userId;
  const projectId = material.project.id;

  await prisma.material.update({
    where: { id: materialId },
    data: { status: MaterialStatus.PROCESSING, error: null },
  });

  try {
    const stored = await getStorage().get(material.storageKey);

    /*
     * Convert to a plain Uint8Array before handing the bytes to PDF.js.
     *
     * A Node Buffer *is* a Uint8Array subclass, so this passes type checking, but
     * PDF.js rejects it at runtime ("Please provide binary data as `Uint8Array`,
     * rather than `Buffer`"). A fresh Uint8Array view is required.
     */
    const file = new Uint8Array(stored);

    const parsed = await extractPdfPages(file);

    // OCR only the pages that need it. Running it over a whole document that already
    // has a text layer would be slow and strictly worse than the text we have.
    const pagesForOcr = selectPagesForOcr(parsed.pages);
    let pages = parsed.pages;
    let ocrPages: number[] = [];

    if (pagesForOcr.length > 0) {
      try {
        const results = await recognisePages(file, pagesForOcr);
        pages = mergeOcrResults(pages, results);
        ocrPages = results.filter((result) => result.text.trim().length > 0).map((r) => r.page);
      } catch (error) {
        /*
         * OCR is a best-effort enhancement, not a prerequisite. Failing the whole
         * document because one optional stage was unavailable would discard the text
         * layer we already extracted successfully.
         *
         * The `totalText` check below still catches the case that actually matters:
         * a document with no usable text at all.
         */
        logger.warn(
          { err: error, materialId, pages: pagesForOcr },
          "OCR failed; continuing with the extracted text layer",
        );
      }
    }

    const totalText = pages.reduce((total, page) => total + page.text.trim().length, 0);

    if (totalText < MIN_USABLE_TEXT_CHARACTERS) {
      throw new DocumentProcessingError(
        "No text could be extracted from this document. It looks like a scanned or image-only PDF, and OCR found nothing readable.",
      );
    }

    const drafts = chunkPages(pages, {
      targetTokens: env.CHUNK_TARGET_TOKENS,
      overlapTokens: env.CHUNK_OVERLAP_TOKENS,
    });

    const { chunkCount } = await replaceChunks({ userId, projectId, materialId, drafts });
    const conceptCount = await extractAndPersistConcepts({
      userId,
      projectId,
      materialId,
      filename: material.filename,
      pages,
    });

    await prisma.$transaction(async (tx) => {
      await tx.material.update({
        where: { id: materialId },
        data: {
          status: MaterialStatus.READY,
          pageCount: parsed.pageCount,
          processedAt: new Date(),
          error: null,
        },
      });

      await recordActivity(tx, {
        userId,
        type: ActivityType.MATERIAL_READY,
        spaceId: material.project.spaceId,
        projectId,
        payload: { name: material.filename, chunkCount, conceptCount },
      });
    });

    return { materialId, pageCount: parsed.pageCount, chunkCount, conceptCount, ocrPages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.$transaction(async (tx) => {
      await tx.material.update({
        where: { id: materialId },
        data: { status: MaterialStatus.FAILED, error: message.slice(0, 500) },
      });

      await recordActivity(tx, {
        userId,
        type: ActivityType.MATERIAL_FAILED,
        spaceId: material.project.spaceId,
        projectId,
        payload: { name: material.filename, reason: message.slice(0, 200) },
      });
    });

    // Rethrown so the job records the failure and schedules its retry.
    throw error;
  }
}

/**
 * Extracts concepts from the document and links them to it.
 *
 * Upserts throughout, so re-running this for the same material updates rather than
 * duplicates — which is what makes a retried job safe.
 */
async function extractAndPersistConcepts(params: {
  userId: string;
  projectId: string;
  materialId: string;
  filename: string;
  pages: Array<{ page: number; text: string }>;
}): Promise<number> {
  const text = params.pages
    .map((page) => page.text)
    .filter((pageText) => pageText.trim().length > 0)
    .join("\n\n");

  if (!text.trim()) return 0;

  const extraction = await extractConcepts(
    { userId: params.userId, projectId: params.projectId },
    { materialTitle: params.filename, text },
  );

  if (extraction.concepts.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const concept of extraction.concepts) {
      const stored = await tx.concept.upsert({
        where: { projectId_name: { projectId: params.projectId, name: concept.name } },
        create: {
          projectId: params.projectId,
          name: concept.name,
          description: concept.description,
          importance: concept.importance,
        },
        update: {
          description: concept.description,
          importance: concept.importance,
        },
        select: { id: true },
      });

      await tx.materialConcept.upsert({
        where: {
          materialId_conceptId: { materialId: params.materialId, conceptId: stored.id },
        },
        create: {
          materialId: params.materialId,
          conceptId: stored.id,
          weight: concept.importance,
        },
        update: { weight: concept.importance },
      });
    }
  });

  return extraction.concepts.length;
}

/** Exposed for the OCR policy test. */
export { needsOcr };
