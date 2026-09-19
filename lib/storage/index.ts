import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/config";
import { StorageError } from "@/lib/errors";

/**
 * Document storage.
 *
 * Behind an interface because the local filesystem is fine for development but not
 * for a deployment with more than one instance, where ephemeral disk is not shared.
 * Swapping in S3 changes nothing at the call sites.
 */

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Rejects any key that could escape the storage root.
 *
 * Keys are built from identifiers, but a filename can reach them, so this is treated
 * as untrusted input: no absolute paths, no `..` segments.
 */
export function assertSafeKey(key: string): string {
  if (!key || key.startsWith("/") || key.startsWith("\\")) {
    throw new StorageError(`Refusing to use an absolute storage key: ${key}`);
  }

  const normalised = path.posix.normalize(key.replace(/\\/g, "/"));

  if (normalised.startsWith("../") || normalised === ".." || path.isAbsolute(normalised)) {
    throw new StorageError(`Refusing to use a storage key that escapes the root: ${key}`);
  }

  return normalised;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const absolute = path.resolve(this.root, assertSafeKey(key));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;

    // Belt and braces: even after normalisation, confirm containment before touching disk.
    if (absolute !== this.root && !absolute.startsWith(rootWithSep)) {
      throw new StorageError(`Resolved storage path escapes the root: ${key}`);
    }

    return absolute;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);

    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    } catch (error) {
      throw new StorageError(`Failed to write ${key} to local storage.`, { cause: error });
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      throw new StorageError(`Failed to read ${key} from local storage.`, { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolve(key), { force: true });
    } catch (error) {
      throw new StorageError(`Failed to delete ${key} from local storage.`, { cause: error });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (cached) return cached;

  if (env.STORAGE_DRIVER === "s3") {
    // Implemented when a deployment actually needs shared storage; failing loudly here
    // beats silently writing to local disk in a multi-instance deployment.
    throw new StorageError(
      "STORAGE_DRIVER=s3 is not implemented yet. Use the local driver, or add an S3 provider in lib/storage.",
    );
  }

  cached = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
  return cached;
}

/** Test seam. */
export function setStorageForTesting(provider: StorageProvider | null): void {
  cached = provider;
}

/** Storage key for an uploaded document. */
export function materialStorageKey(projectId: string, materialId: string, extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").slice(0, 10);
  return `materials/${projectId}/${materialId}${safeExtension ? `.${safeExtension}` : ""}`;
}
