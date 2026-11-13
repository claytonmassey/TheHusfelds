import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findAssetBySha, saveUploadedAsset } from "@/ingest/database";
import { kindFor, mimeTypeFor } from "@/ingest/files";
import { sha256File } from "@/ingest/hash";
import { rememberTranscript } from "@/ingest/understand";
import { uploadToBlob } from "@/ingest/blob";
import type { CatalogAsset } from "@/lib/catalog";

const ALLOWED = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "pdf", "txt"]);
const MAX_BYTES = 20 * 1024 * 1024;

export type UploadedDocument = {
  filename: string;
  sourcePath: string;
  alreadyStored: boolean;
  transcript: string;
};

export async function ingestUploadedDocument(file: File): Promise<UploadedDocument> {
  const original = path.basename(file.name || "document");
  const extension = path.extname(original).slice(1).toLowerCase();
  if (!ALLOWED.has(extension)) {
    throw new Error("Upload a photo, a PDF, or a text file.");
  }
  if (file.size > MAX_BYTES) throw new Error("Files need to be 20 MB or smaller.");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  const directory = await mkdtemp(path.join(tmpdir(), "husfelds-upload-"));
  try {
    const tempPath = path.join(directory, `upload.${extension}`);
    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const info = await stat(tempPath);
    if (info.size === 0) throw new Error("That file is empty.");

    const sha256 = await sha256File(tempPath);
    const sourcePath = `uploads/${sha256}.${extension}`;
    const absolute = path.join(sourceDir, "uploads", `${sha256}.${extension}`);
    await mkdir(path.dirname(absolute), { recursive: true });
    try {
      await stat(absolute);
    } catch {
      await copyFile(tempPath, absolute);
    }

    const existing = await findAssetBySha(sha256);
    const capture = existing?.capture.basename ?? `upload-${safeStem(original)}-${sha256.slice(0, 8)}`;
    const asset = catalogAsset({
      filename: original,
      extension,
      sourcePath,
      sha256,
      byteSize: info.size,
      modified: info.mtime.toISOString(),
      blobUrl: existing?.blobUrl ?? null,
      blobPathname: existing?.blobPathname ?? null,
      status: existing?.status === "UPLOADED" ? "UPLOADED" : "CATALOGED",
    });

    if (!asset.blobPathname) {
      try {
        const blob = await uploadToBlob(absolute, asset, token);
        asset.blobUrl = blob.url;
        asset.blobPathname = blob.pathname;
        asset.status = "UPLOADED";
        asset.error = null;
      } catch (error) {
        asset.status = "FAILED";
        asset.error = error instanceof Error ? error.message : "Blob upload failed.";
        await saveUploadedAsset(asset, capture);
        throw new Error(asset.error);
      }
    }

    await saveUploadedAsset(asset, capture);
    const transcript = await rememberTranscript(sourceDir, asset, capture);
    return {
      filename: original,
      sourcePath,
      alreadyStored: Boolean(existing?.blobPathname),
      transcript,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
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
    capturedAt: null,
    sourceModified: input.modified,
    blobUrl: input.blobUrl,
    blobPathname: input.blobPathname,
    status: input.status,
    error: null,
  };
}
