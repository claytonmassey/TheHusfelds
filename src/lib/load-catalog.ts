import { readFile } from "node:fs/promises";

import type { CatalogFile } from "@/lib/catalog";
import { summarize } from "@/lib/catalog";
import { blobConfigured, databaseConfigured, getPrisma, vectorDatabaseConfigured } from "@/lib/prisma";

export type CatalogSource = "database" | "local" | "empty";

export type LoadedCatalog = {
  catalog: CatalogFile | null;
  source: CatalogSource;
  databaseConfigured: boolean;
  blobConfigured: boolean;
  vectorConfigured: boolean;
  notice: string | null;
};

const LOCAL_CATALOG = "data/catalog.json";

export async function loadCatalog(): Promise<LoadedCatalog> {
  const database = databaseConfigured();
  const blob = blobConfigured();
  const vector = vectorDatabaseConfigured();

  if (database) {
    try {
      const fromDatabase = await readDatabaseCatalog();
      if (fromDatabase && fromDatabase.stats.captures > 0) {
        return {
          catalog: fromDatabase,
          source: "database",
          databaseConfigured: true,
          blobConfigured: blob,
          vectorConfigured: vector,
          notice: null,
        };
      }

      const local = await readLocalCatalog();
      if (local) {
        return {
          catalog: local,
          source: "local",
          databaseConfigured: true,
          blobConfigured: blob,
          vectorConfigured: vector,
          notice: "Prisma is connected and still empty, so this view is the local catalog.",
        };
      }
    } catch (error) {
      const local = await readLocalCatalog();
      const message = error instanceof Error ? error.message : "Could not read Prisma.";
      if (local) {
        return {
          catalog: local,
          source: "local",
          databaseConfigured: true,
          blobConfigured: blob,
          vectorConfigured: vector,
          notice: `Prisma could not be read (${message}). Showing the local catalog.`,
        };
      }
      return {
        catalog: null,
        source: "empty",
        databaseConfigured: true,
        blobConfigured: blob,
        vectorConfigured: vector,
        notice: message,
      };
    }
  }

  const local = await readLocalCatalog();
  return {
    catalog: local,
    source: local ? "local" : "empty",
    databaseConfigured: database,
    blobConfigured: blob,
    vectorConfigured: vector,
    notice: null,
  };
}

async function readLocalCatalog(): Promise<CatalogFile | null> {
  try {
    const raw = await readFile(LOCAL_CATALOG, "utf8");
    const parsed = JSON.parse(raw) as CatalogFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.captures)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readDatabaseCatalog(): Promise<CatalogFile | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const captures = await prisma.capture.findMany({
    include: { assets: { orderBy: { filename: "asc" } } },
    orderBy: [{ capturedAt: "desc" }, { basename: "desc" }],
  });

  const mapped = captures.map((capture) => ({
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

  const latest = captures.reduce<Date | null>((current, capture) => {
    if (!current || capture.updatedAt > current) return capture.updatedAt;
    return current;
  }, null);

  return {
    version: 1,
    generatedAt: (latest ?? new Date()).toISOString(),
    sourceDir: process.env.SOURCE_DIR ?? "Source",
    stats: summarize(mapped),
    captures: mapped,
  };
}
