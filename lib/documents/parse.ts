import { extractText } from "unpdf";
import { DocumentProcessingError } from "@/lib/errors";

/**
 * PDF text extraction.
 *
 * Extracts the text layer per page rather than as one blob, because citations are
 * only useful if they can point at a page. Pages that are scans, diagrams, or images
 * yield little or nothing here — the caller decides whether that warrants OCR.
 */

export type ParsedPage = {
  page: number;
  text: string;
};

export type ParsedDocument = {
  pages: ParsedPage[];
  pageCount: number;
};

/**
 * Normalises PDF text without destroying its structure.
 *
 * PDF extraction produces hard line breaks mid-sentence, ligatures, and non-breaking
 * spaces. Leaving those in place would fragment sentences across chunks and hurt
 * retrieval, so lines are reflowed while paragraph breaks are preserved.
 */
export function normaliseExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    // A single newline is a wrapped line; a blank line is a real paragraph break.
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfPages(data: Uint8Array): Promise<ParsedDocument> {
  let result: { totalPages: number; text: string[] };

  try {
    result = await extractText(data, { mergePages: false });
  } catch (error) {
    throw new DocumentProcessingError("The PDF could not be read.", { cause: error });
  }

  const texts = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];

  return {
    pages: texts.map((text, index) => ({
      page: index + 1,
      text: normaliseExtractedText(text),
    })),
    pageCount: result.totalPages ?? texts.length,
  };
}

/**
 * Whether a page has too little text to be useful, and so should be OCR'd.
 *
 * Character count is a crude proxy, but it is a reliable one: a real text page
 * yields hundreds of characters, while a scanned page or a diagram yields a few
 * stray glyphs or nothing at all.
 */
export function needsOcr(text: string, minimumCharacters: number): boolean {
  return text.trim().length < minimumCharacters;
}
