import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset, CatalogCapture, CatalogFile, MediaKind } from "../lib/catalog";
import { getPrisma, vectorDatabaseConfigured } from "../lib/prisma";

const VECTOR_KINDS = new Set<MediaKind>(["IMAGE", "VIDEO"]);
const DEFAULT_CATALOG = path.join("data", "catalog.json");
const BATCH_SIZE = 100;

export type VectorRecord = {
  id: string;
  data: string;
  metadata: Record<string, string | number | boolean>;
};

export function vectorCandidates(assets: CatalogAsset[]): CatalogAsset[] {
  return assets.filter((asset) => VECTOR_KINDS.has(asset.kind));
}

export function vectorRecord(asset: CatalogAsset, capture: string): VectorRecord {
  const details = [
    asset.filename,
    asset.kind === "VIDEO" ? "video" : "image",
    asset.mimeType,
    asset.width && asset.height ? `${asset.width} by ${asset.height}` : "",
    asset.durationMs != null ? `${(asset.durationMs / 1000).toFixed(1)} seconds` : "",
    asset.capturedAt ? `captured ${asset.capturedAt}` : "",
    `capture ${capture}`,
  ].filter(Boolean);

  const metadata: Record<string, string | number | boolean> = {
    sourcePath: asset.sourcePath,
    filename: asset.filename,
    capture,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
  };
  if (asset.width) metadata.width = asset.width;
  if (asset.height) metadata.height = asset.height;
  if (asset.durationMs != null) metadata.durationMs = asset.durationMs;
  if (asset.capturedAt) metadata.capturedAt = asset.capturedAt;
  if (asset.blobPathname) metadata.blobPathname = asset.blobPathname;
  if (asset.blobUrl) metadata.blobUrl = asset.blobUrl;

  return {
    id: asset.sourcePath,
    data: details.join(". "),
    metadata,
  };
}

export async function ingestBlobIntoVector(options: { catalogPath?: string; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(message));
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!vectorDatabaseConfigured() || !url || !token) {
    throw new Error("Upstash Vector is not configured. Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN.");
  }

  const captures = await loadCaptures(options.catalogPath ?? DEFAULT_CATALOG);
  const records = captures.flatMap((capture) =>
    vectorCandidates(capture.assets).map((asset) => vectorRecord(asset, capture.basename)),
  );
  if (records.length === 0) {
    throw new Error("The catalog has no images or videos to embed. Run npm run ingest first.");
  }

  let written = 0;
  for (let index = 0; index < records.length; index += BATCH_SIZE) {
    const batch = records.slice(index, index + BATCH_SIZE);
    const response = await fetch(`${url.replace(/\/$/, "")}/upsert-data`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 422 && detail.includes("embedding model")) {
        throw new Error(
          "Upstash refused the upsert. This index has no embedding model, so it cannot store records for AI search. Recreate it as a dense index with an embedding model, then run npm run ingest:vectors again.",
        );
      }
      throw new Error(`Upstash upsert failed (${response.status}). ${detail.slice(0, 300)}`);
    }
    written += batch.length;
    log(`Embedded ${written}/${records.length}.`);
  }

  log(`Stored ${written} images and videos in Upstash Vector.`);
  return { written };
}

async function loadCaptures(catalogPath: string): Promise<CatalogCapture[]> {
  const prisma = getPrisma();
  if (prisma) {
    const captures = await prisma.capture.findMany({
      include: { assets: true },
      orderBy: { basename: "asc" },
    });
    if (captures.length > 0) {
      return captures.map((capture) => ({
        basename: capture.basename,
        capturedAt: capture.capturedAt?.toISOString() ?? null,
        assets: capture.assets.map((asset) => ({
          sourcePath: asset.sourcePath,
          filename: asset.filename,
          extension: asset.extension,
          kind: asset.kind,
          mimeType: asset.mimeType,
          byteSize: Number(asset.byteSize),
          sha256: asset.sha256,
          width: asset.width,
          height: asset.height,
          durationMs: asset.durationMs,
          capturedAt: asset.capturedAt?.toISOString() ?? null,
          sourceModified: asset.sourceModified.toISOString(),
          blobUrl: asset.blobUrl,
          blobPathname: asset.blobPathname,
          status: asset.status,
          error: asset.error,
        })),
      }));
    }
  }

  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as CatalogFile;
  return catalog.captures;
}
