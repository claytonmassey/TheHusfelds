import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findAssetBySha, saveUploadedAsset } from "@/ingest/database";
import { kindFor, mimeTypeFor } from "@/ingest/files";
import { sha256File } from "@/ingest/hash";
import { rememberLocalAsset } from "@/ingest/local-catalog";
import { rememberTranscript } from "@/ingest/understand";
import { uploadToBlob } from "@/ingest/blob";
import type { CatalogAsset } from "@/lib/catalog";
import { storeImagePreviews } from "@/lib/image-preview";

const ALLOWED = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "pdf", "txt"]);
const MAX_BYTES = 20 * 1024 * 1024;

export type UploadedDocument = {
  filename: string;
  sourcePath: string;
  alreadyStored: boolean;
  transcript: string;
  warning?: string;
};

export async function ingestUploadedDocument(file: File): Promise<UploadedDocument> {
  const original = path.basename(file.name || "document");
  const extension = path.extname(original).slice(1).toLowerCase();
  if (!ALLOWED.has(extension)) {
    throw new Error("Upload a photo, a PDF, or a text file.");
  }
  if (file.size > MAX_BYTES) throw new Error("Files need to be 20 MB or smaller.");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  const directory = await mkdtemp(path.join(tmpdir(), "husfelds-upload-"));
  try {
    const tempPath = path.join(directory, `upload.${extension}`);
    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const info = await stat(tempPath);
    if (info.size === 0) throw new Error("That file is empty.");

    const sha256 = await sha256File(tempPath);
    const sourcePath = `uploads/${sha256}.${extension}`;
    const localCopy = await keepLocalCopy(sourceDir, sourcePath, tempPath);
    const absolute = localCopy ?? tempPath;
    if (!token && !localCopy) throw new Error("The photo could not be saved.");

    const existing = await findAssetBySha(sha256).catch(() => null);
    const capture = existing?.capture.basename ?? `upload-${safeStem(original)}-${sha256.slice(0, 8)}`;
    const modified = info.mtime.toISOString();
    const asset = catalogAsset({
      filename: original,
      extension,
      sourcePath,
      sha256,
      byteSize: info.size,
      modified,
      blobUrl: existing?.blobUrl ?? null,
      blobPathname: existing?.blobPathname ?? null,
      status: existing?.status === "UPLOADED" ? "UPLOADED" : "CATALOGED",
    });

    let warning: string | undefined;
    if (token && !asset.blobPathname) {
      try {
        const blob = await uploadToBlob(absolute, asset, token);
        asset.blobUrl = blob.url;
        asset.blobPathname = blob.pathname;
        asset.status = "UPLOADED";
        asset.error = null;
      } catch {
        asset.status = "FAILED";
        if (!localCopy) throw new Error("The photo could not be copied to storage.");
        warning = "Saved on this Mac. The photo file could not be copied to storage.";
      }
    }

    let savedToDatabase = true;
    try {
      await saveUploadedAsset(asset, capture);
    } catch (error) {
      savedToDatabase = false;
      warning = quietDatabaseMessage(error);
    }
    let savedLocally = true;
    try {
      await rememberLocalAsset(asset, capture, sourceDir);
    } catch {
      savedLocally = false;
    }
    if (!savedToDatabase && !savedLocally) throw new Error("The photo could not be saved.");

    if (token && asset.kind === "IMAGE") {
      try {
        await storeImagePreviews({ absolute, sha256, extension, token });
      } catch {
        warning ??= "Added to the library. A smaller copy could not be saved.";
      }
    }

    let transcript = "";
    try {
      transcript = await rememberTranscript(sourceDir, asset, capture);
    } catch {
      warning ??= "Added to the library. The page could not be read yet.";
    }
    return {
      filename: original,
      sourcePath,
      alreadyStored: Boolean(existing?.blobPathname),
      transcript,
      warning,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function quietDatabaseMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/database|pool|prisma|reach database|timed out|can't reach/i.test(message)) {
    return "Saved on this Mac. The catalog will update when the database is reachable.";
  }
  return "Saved on this Mac. The catalog could not be updated.";
}

async function keepLocalCopy(sourceDir: string, sourcePath: string, tempPath: string): Promise<string | null> {
  const absolute = path.join(sourceDir, ...sourcePath.split("/"));
  try {
    await mkdir(path.dirname(absolute), { recursive: true });
    try {
      await stat(absolute);
    } catch {
      await copyFile(tempPath, absolute);
    }
    return absolute;
  } catch {
    // The live server cannot create the local photo folder. The temporary file is stored instead.
    return null;
  }
}

function safeStem(filename: string): string {
  const stem = path.parse(filename).name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (stem || "document").slice(0, 48);
}

function catalogAsset(input: {
  filename: string;
  extension: string;
  sourcePath: string;
  sha256: string;
  byteSize: number;
  modified: string;
  blobUrl: string | null;
  blobPathname: string | null;
  status: CatalogAsset["status"];
}): CatalogAsset {
  return {
    sourcePath: input.sourcePath,
    filename: input.filename,
    extension: input.extension,
    kind: kindFor(input.extension),
    mimeType: mimeTypeFor(input.extension),
    byteSize: input.byteSize,
    sha256: input.sha256,
    width: null,
    height: null,
    durationMs: null,
    capturedAt: input.modified,
    sourceModified: input.modified,
    blobUrl: input.blobUrl,
    blobPathname: input.blobPathname,
    status: input.status,
    error: null,
  };
}
