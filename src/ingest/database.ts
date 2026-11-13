import type { CatalogAsset, CatalogFile } from "../lib/catalog";
import { getPrisma } from "../lib/prisma";

export async function syncCatalogToPrisma(catalog: CatalogFile): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL is not set.");

  for (const capture of catalog.captures) {
    const saved = await prisma.capture.upsert({
      where: { basename: capture.basename },
      create: {
        basename: capture.basename,
        capturedAt: toDate(capture.capturedAt),
      },
      update: {
        capturedAt: toDate(capture.capturedAt),
      },
    });

    await prisma.$transaction(
      capture.assets.map((asset) =>
        prisma.asset.upsert({
          where: { sourcePath: asset.sourcePath },
          create: assetWrite(saved.id, asset),
          update: assetWrite(saved.id, asset),
        }),
      ),
    );
  }
}

function assetWrite(captureId: string, asset: CatalogAsset) {
  return {
    captureId,
    sourcePath: asset.sourcePath,
    filename: asset.filename,
    extension: asset.extension,
    kind: asset.kind,
    mimeType: asset.mimeType,
    byteSize: BigInt(asset.byteSize),
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    capturedAt: toDate(asset.capturedAt),
    sourceModified: new Date(asset.sourceModified),
    blobUrl: asset.blobUrl,
    blobPathname: asset.blobPathname,
    status: asset.status,
    error: asset.error,
  };
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
