import { extractImages } from "unpdf";
import { createCanvas, ImageData, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { env } from "@/lib/config";
import { DocumentProcessingError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { normaliseExtractedText } from "@/lib/documents/parse";

/**
 * OCR fallback for pages with no usable text layer.
 *
 * Rather than rasterising the page with PDF.js, this reads the image already embedded
 * in the page and recognises that. For a genuinely scanned document the page content
 * *is* an image, so this is both more direct and considerably faster — no renderer,
 * no canvas transfer between PDF.js's worker and the main thread, and no dependence
 * on a headless canvas implementation agreeing with PDF.js about render parameters.
 *
 * The trade-off is deliberate: a page whose content is vector art rather than a
 * bitmap has no image to extract, and simply yields no OCR text. The page keeps
 * whatever the text layer gave it, so nothing is lost.
 *
 * Tesseract downloads its language data on first use. A failure to fetch it is
 * reported rather than swallowed, because silently returning empty text would look
 * indistinguishable from "this page has no content".
 */

export type OcrResult = {
  page: number;
  text: string;
};

/**
 * An image lifted from a page.
 *
 * Declared here rather than imported because unpdf keeps `ExtractedImageObject`
 * internal. This mirrors its public return shape, so the value `extractImages`
 * resolves to is structurally assignable.
 */
export type ExtractedPageImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  key: string;
};

/** Tesseract needs an encoded image, so raw pixels are converted to RGBA and encoded. */
function toRgbaPixels(image: ExtractedPageImage): Uint8ClampedArray {
  const pixelCount = image.width * image.height;
  const source = image.data;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let index = 0; index < pixelCount; index += 1) {
    const target = index * 4;

    if (image.channels === 4) {
      rgba[target] = source[index * 4]!;
      rgba[target + 1] = source[index * 4 + 1]!;
      rgba[target + 2] = source[index * 4 + 2]!;
      rgba[target + 3] = source[index * 4 + 3]!;
    } else if (image.channels === 3) {
      rgba[target] = source[index * 3]!;
      rgba[target + 1] = source[index * 3 + 1]!;
      rgba[target + 2] = source[index * 3 + 2]!;
      rgba[target + 3] = 255;
    } else {
      const grey = source[index]!;
      rgba[target] = grey;
      rgba[target + 1] = grey;
      rgba[target + 2] = grey;
      rgba[target + 3] = 255;
    }
  }

  return rgba;
}

export function encodeImageAsPng(image: ExtractedPageImage): Buffer {
  const canvas = createCanvas(image.width, image.height);
  const context = context2d(canvas);

  context.putImageData(new ImageData(toRgbaPixels(image), image.width, image.height), 0, 0);

  return canvas.toBuffer("image/png");
}

function context2d(canvas: Canvas): SKRSContext2D {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new DocumentProcessingError("Could not obtain a 2D canvas context for OCR.");
  }

  return context;
}

/** Picks the largest image on a page — the page scan, rather than a logo or rule. */
export function largestImage<T extends { width: number; height: number }>(
  images: T[],
): T | null {
  if (images.length === 0) return null;

  return images.reduce((largest, candidate) =>
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest,
  );
}

export async function recognisePages(
  data: Uint8Array,
  pageNumbers: number[],
): Promise<OcrResult[]> {
  if (pageNumbers.length === 0) return [];

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  const results: OcrResult[] = [];

  try {
    worker = await createWorker("eng");

    for (const pageNumber of pageNumbers) {
      const images = await extractImages(data, pageNumber);
      const pageImage = largestImage(images);

      if (!pageImage) {
        // Nothing to recognise; the caller keeps the original page text.
        results.push({ page: pageNumber, text: "" });
        continue;
      }

      const { data: recognised } = await worker.recognize(encodeImageAsPng(pageImage));

      results.push({
        page: pageNumber,
        text: normaliseExtractedText(recognised.text ?? ""),
      });
    }
  } catch (error) {
    throw new DocumentProcessingError("Optical character recognition failed for this document.", {
      cause: error,
    });
  } finally {
    if (worker) {
      await worker.terminate().catch((error: unknown) => {
        logger.warn({ err: error }, "Failed to terminate the OCR worker cleanly");
      });
    }
  }

  return results;
}

/**
 * Merges OCR text into the extracted pages, only where OCR actually found something.
 *
 * A page that OCRs to less text than it already had keeps its original content —
 * OCR is a fallback, not a replacement.
 */
export function mergeOcrResults(
  pages: Array<{ page: number; text: string }>,
  ocrResults: OcrResult[],
): Array<{ page: number; text: string }> {
  const byPage = new Map(ocrResults.map((result) => [result.page, result.text]));

  return pages.map((page) => {
    const ocrText = byPage.get(page.page);

    if (!ocrText || ocrText.length <= page.text.length) return page;

    return { page: page.page, text: ocrText };
  });
}

/** Selects which pages deserve OCR for a document. */
export function selectPagesForOcr(pages: Array<{ page: number; text: string }>): number[] {
  if (!env.OCR_ENABLED) return [];

  return pages
    .filter((page) => page.text.trim().length < env.OCR_MIN_CHARS_PER_PAGE)
    .map((page) => page.page);
}
