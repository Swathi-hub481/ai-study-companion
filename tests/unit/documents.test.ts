import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { needsOcr, normaliseExtractedText } from "@/lib/documents/parse";
import { assertSafeKey, materialStorageKey, getStorage, setStorageForTesting } from "@/lib/storage";
import { sanitiseFilename } from "@/lib/services/materials";
import { StorageError } from "@/lib/errors";
import { resetConfigCache } from "@/lib/config";

describe("normaliseExtractedText", () => {
  it("reflows lines that the PDF extractor wrapped mid-sentence", () => {
    // A wrapped line break inside a sentence would otherwise split it across chunks.
    expect(normaliseExtractedText("Gradient descent minimises\nthe loss function.")).toBe(
      "Gradient descent minimises the loss function.",
    );
  });

  it("preserves paragraph breaks", () => {
    expect(normaliseExtractedText("First paragraph.\n\nSecond paragraph.")).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
  });

  it("collapses runs of whitespace and blank lines", () => {
    expect(normaliseExtractedText("A   B\n\n\n\nC")).toBe("A B\n\nC");
  });

  it("normalises non-breaking spaces and curly quotes", () => {
    expect(normaliseExtractedText("the\u00a0model\u2019s \u201cbias\u201d")).toBe(
      'the model\'s "bias"',
    );
  });

  it("trims the result", () => {
    expect(normaliseExtractedText("\n\n  content  \n\n")).toBe("content");
  });
});

describe("needsOcr", () => {
  it("flags a page with almost no text, such as a scan", () => {
    expect(needsOcr("", 120)).toBe(true);
    expect(needsOcr("   ", 120)).toBe(true);
    expect(needsOcr("Page 4", 120)).toBe(true);
  });

  it("accepts a page with a real text layer", () => {
    expect(needsOcr("x".repeat(200), 120)).toBe(false);
  });
});

describe("assertSafeKey", () => {
  it("accepts a normal nested key", () => {
    expect(assertSafeKey("materials/project/thing.pdf")).toBe("materials/project/thing.pdf");
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafeKey("/etc/passwd")).toThrow(StorageError);
    expect(() => assertSafeKey("\\\\server\\share")).toThrow(StorageError);
  });

  it("rejects traversal out of the root", () => {
    expect(() => assertSafeKey("../../secrets.txt")).toThrow(StorageError);
    expect(() => assertSafeKey("materials/../../escape.pdf")).toThrow(StorageError);
    expect(() => assertSafeKey("..")).toThrow(StorageError);
  });

  it("rejects an empty key", () => {
    expect(() => assertSafeKey("")).toThrow(StorageError);
  });
});

describe("materialStorageKey", () => {
  it("namespaces by project", () => {
    expect(materialStorageKey("proj-1", "mat-1", "pdf")).toBe("materials/proj-1/mat-1.pdf");
  });

  it("strips anything unusual from the extension", () => {
    // Only alphanumerics survive, so a traversal attempt cannot reach the key.
    expect(materialStorageKey("p", "m", "../evil")).toBe("materials/p/m.evil");
    expect(materialStorageKey("p", "m", "pd/f")).toBe("materials/p/m.pdf");
  });

  it("omits the dot when there is no usable extension", () => {
    expect(materialStorageKey("p", "m", "")).toBe("materials/p/m");
  });
});

describe("sanitiseFilename", () => {
  it("keeps a normal filename", () => {
    expect(sanitiseFilename("Lecture Notes.pdf")).toBe("Lecture Notes.pdf");
  });

  it("strips directory components", () => {
    expect(sanitiseFilename("C:\\Users\\me\\notes.pdf")).toBe("notes.pdf");
    expect(sanitiseFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
  });

  it("strips control characters", () => {
    expect(sanitiseFilename("bad\u0000name.pdf")).toBe("badname.pdf");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitiseFilename("   ")).toBe("document.pdf");
  });
});

describe("local storage provider", () => {
  it("round-trips a file and refuses to escape its root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "asc-storage-"));
    const previous = process.env.STORAGE_LOCAL_DIR;
    process.env.STORAGE_LOCAL_DIR = root;
    // Config is memoised, so the change only takes effect after clearing the cache.
    resetConfigCache();
    setStorageForTesting(null);

    try {
      const storage = getStorage();

      await storage.put("materials/p/m.pdf", Buffer.from("hello"));
      expect(await storage.exists("materials/p/m.pdf")).toBe(true);
      expect((await storage.get("materials/p/m.pdf")).toString()).toBe("hello");

      await storage.delete("materials/p/m.pdf");
      expect(await storage.exists("materials/p/m.pdf")).toBe(false);

      await expect(storage.get("../../outside.txt")).rejects.toThrow(StorageError);
    } finally {
      setStorageForTesting(null);
      if (previous === undefined) delete process.env.STORAGE_LOCAL_DIR;
      else process.env.STORAGE_LOCAL_DIR = previous;
      resetConfigCache();
      await rm(root, { recursive: true, force: true });
    }
  });
});
