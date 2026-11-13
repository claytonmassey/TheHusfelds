import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset, CatalogFile, MediaKind } from "../lib/catalog";
import { getPrisma, vectorDatabaseConfigured } from "../lib/prisma";

const VECTOR_KINDS = new Set<MediaKind>(["IMAGE", "VIDEO"]);
const DEFAULT_CATALOG = path.join("data", "catalog.json");

export function vectorCandidates(assets: CatalogAsset[]): CatalogAsset[] {
  return assets.filter(
    (asset) =>
      VECTOR_KINDS.has(asset.kind) &&
      asset.status === "UPLOADED" &&
      Boolean(asset.blobUrl) &&
      Boolean(asset.blobPathname),
  );
}

export async function ingestBlobIntoVector(options: { catalogPath?: string; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(message));
  if (!vectorDatabaseConfigured()) {
    throw new Error("VECTOR_DATABASE_URL is not set. Create the vector database, then run npm run ingest:vectors.");
  }

  const assets = await loadBlobAssets(options.catalogPath ?? DEFAULT_CATALOG);
  const ready = vectorCandidates(assets);
  if (ready.length === 0) {
    throw new Error("No Blob objects are ready. After the Vercel site exists, run npm run import:blob, then npm run ingest:vectors.");
  }

  const vector = await getVectorPrisma();
  let written = 0;
  for (const asset of ready) {
    await vector.vectorDocument.upsert({
      where: { sourcePath: asset.sourcePath },
      create: documentWrite(asset),
      update: documentWrite(asset),
    });
    written += 1;
    if (written % 50 === 0) log(`Registered ${written}/${ready.length} Blob objects.`);
  }

  log(`Registered ${written} Blob objects in the vector database. Embeddings stay pending until a model is chosen.`);
  await vector.$disconnect();
  return { written };
}

function documentWrite(asset: CatalogAsset) {
  return {
    sourcePath: asset.sourcePath,
    sha256: asset.sha256,
    filename: asset.filename,
    kind: asset.kind,
    mimeType: asset.mimeType,
    blobUrl: asset.blobUrl ?? "",
    blobPathname: asset.blobPathname ?? "",
    capturedAt: asset.capturedAt ? new Date(asset.capturedAt) : null,
    status: "PENDING" as const,
    error: null,
  };
}

async function loadBlobAssets(catalogPath: string): Promise<CatalogAsset[]> {
  const prisma = getPrisma();
  if (prisma) {
    const assets = await prisma.asset.findMany({
      where: { blobPathname: { not: null }, kind: { in: ["IMAGE", "VIDEO"] } },
    });
    if (assets.length > 0) {
      return assets.map((asset) => ({
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
      }));
    }
  }

  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as CatalogFile;
  return catalog.captures.flatMap((capture) => capture.assets);
}

async function getVectorPrisma() {
  const { PrismaClient } = await import("@prisma/vector-client");
  return new PrismaClient();
}
