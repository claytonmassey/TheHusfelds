import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset, CatalogCapture, CatalogFile } from "../lib/catalog";
import { summarize } from "../lib/catalog";
import { absoluteFromSource, blobPathnameFor, uploadToBlob } from "./blob";
import { syncCatalogToPrisma } from "./database";
import { captureKeyFor, groupFiles, kindFor, mimeTypeFor, type ScannedFile } from "./files";
import { mapPool, sha256File } from "./hash";
import { readSpotlightMetadata } from "./metadata";
import { databaseConfigured, blobConfigured } from "../lib/prisma";
import { scanSource } from "./scan";

export type IngestOptions = {
  sourceDir: string;
  catalogPath?: string;
  limit?: number;
  dryRun?: boolean;
  /** Upload file bytes to Vercel Blob. Used by import:blob, after the Vercel project exists. */
  upload?: boolean;
  force?: boolean;
  log?: (message: string) => void;
};

export type IngestResult = {
  catalog: CatalogFile;
  wroteCatalog: boolean;
  database: "synced" | "skipped" | "failed";
  blob: "uploaded" | "skipped" | "failed";
  databaseError?: string;
  uploaded: number;
  uploadFailed: number;
};

const DEFAULT_CATALOG = path.join("data", "catalog.json");

export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  const sourceDir = path.resolve(options.sourceDir);
  const catalogPath = path.resolve(options.catalogPath ?? DEFAULT_CATALOG);

  if (options.upload && !options.dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Create the Blob store on the Vercel project, then run npm run import:blob.",
    );
  }

  let scanned: ScannedFile[];
  try {
    scanned = await scanSource(sourceDir);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      throw new Error(`Source directory not found: ${sourceDir}`);
    }
    throw error;
  }

  const previous = options.force ? null : await readCatalog(catalogPath);
  const previousAssets = new Map<string, CatalogAsset>();
  for (const capture of previous?.captures ?? []) {
    for (const asset of capture.assets) previousAssets.set(asset.sourcePath, asset);
  }

  const groups = groupFiles(scanned);
  let keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  if (options.limit != null) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("--limit must be a positive integer.");
    }
    keys = keys.slice(0, options.limit);
  }

  const selected = keys.flatMap((key) => groups.get(key) ?? []);
  log(`Scanning ${selected.length} files in ${keys.length} captures.`);

  const metadata = await readSpotlightMetadata(selected.map((file) => file.absolutePath));
  const metadataByPath = new Map(selected.map((file, index) => [file.relativePath, metadata[index]]));

  let hashed = 0;
  let reused = 0;
  const assets = await mapPool(selected, 4, async (file) => {
    const prior = previousAssets.get(file.relativePath);
    const canReuse =
      prior &&
      prior.byteSize === file.byteSize &&
      prior.sourceModified === file.sourceModified &&
      prior.sha256.length === 64;

    const sha256 = canReuse ? prior.sha256 : await sha256File(file.absolutePath);
    if (canReuse) reused += 1;
    else hashed += 1;
    if ((hashed + reused) % 50 === 0 || hashed + reused === selected.length) {
      log(`Hashed ${hashed + reused}/${selected.length} (${reused} unchanged).`);
    }

    const spot = metadataByPath.get(file.relativePath);
    const asset: CatalogAsset = {
      sourcePath: file.relativePath,
      filename: file.filename,
      extension: file.extension,
      kind: kindFor(file.extension),
      mimeType: mimeTypeFor(file.extension),
      byteSize: file.byteSize,
      sha256,
      width: spot?.width ?? null,
      height: spot?.height ?? null,
      durationMs: spot?.durationMs ?? null,
      capturedAt: spot?.capturedAt ?? null,
      sourceModified: file.sourceModified,
      blobUrl: canReuse ? prior.blobUrl : null,
      blobPathname: canReuse ? prior.blobPathname : null,
      status: canReuse ? prior.status : "CATALOGED",
      error: canReuse && prior.status === "FAILED" ? prior.error : null,
    };

    if (options.force) {
      asset.blobUrl = null;
      asset.blobPathname = null;
      asset.status = "CATALOGED";
      asset.error = null;
    }
    return asset;
  });

  const grouped = new Map<string, CatalogAsset[]>();
  for (const asset of assets) {
    const key = captureKeyFor(asset.sourcePath);
    const list = grouped.get(key);
    if (list) list.push(asset);
    else grouped.set(key, [asset]);
  }

  const captures: CatalogCapture[] = keys.map((key) => {
    const captureAssets = [...(grouped.get(key) ?? [])].sort((a, b) => a.filename.localeCompare(b.filename));
    return {
      basename: key,
      capturedAt: earliest(captureAssets.map((asset) => asset.capturedAt)),
      assets: captureAssets,
    };
  });

  captures.sort(compareCaptures);

  const catalog: CatalogFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceDir,
    stats: summarize(captures),
    captures,
  };

  let uploaded = 0;
  let uploadFailed = 0;
  let blob: IngestResult["blob"] = "skipped";
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const shouldUpload = Boolean(options.upload) && !options.dryRun && blobConfigured();

  if (shouldUpload && token) {
    const known = new Map<string, { url: string; pathname: string }>();
    for (const asset of assets) {
      if (asset.status === "UPLOADED" && asset.blobUrl && asset.blobPathname) {
        known.set(asset.sha256, { url: asset.blobUrl, pathname: asset.blobPathname });
      }
    }

    for (const asset of assets) {
      const existing = known.get(asset.sha256);
      if (existing && asset.status === "UPLOADED") continue;
      if (existing) {
        asset.blobUrl = existing.url;
        asset.blobPathname = existing.pathname;
        asset.status = "UPLOADED";
        asset.error = null;
        uploaded += 1;
        continue;
      }

      try {
        const saved = await uploadToBlob(absoluteFromSource(sourceDir, asset.sourcePath), asset, token);
        asset.blobUrl = saved.url;
        asset.blobPathname = saved.pathname || blobPathnameFor(asset);
        asset.status = "UPLOADED";
        asset.error = null;
        known.set(asset.sha256, { url: asset.blobUrl, pathname: asset.blobPathname });
        uploaded += 1;
        if (uploaded % 10 === 0) {
          catalog.stats = summarize(captures);
          await writeCatalog(catalogPath, catalog);
          log(`Uploaded ${uploaded} files.`);
        }
      } catch (error) {
        uploadFailed += 1;
        asset.status = "FAILED";
        asset.error = error instanceof Error ? error.message : "Upload failed.";
        log(`Upload failed for ${asset.filename}: ${asset.error}`);
      }
    }
    catalog.stats = summarize(captures);
    blob = uploadFailed > 0 ? "failed" : "uploaded";
    log(`Imported ${uploaded} files into Blob.`);
  }

  let wroteCatalog = false;
  if (!options.dryRun) {
    await writeCatalog(catalogPath, catalog);
    wroteCatalog = true;
    log(`Wrote ${catalogPath}`);
  }

  let database: IngestResult["database"] = "skipped";
  let databaseError: string | undefined;
  if (!options.dryRun && databaseConfigured()) {
    try {
      await syncCatalogToPrisma(catalog);
      database = "synced";
      log(`Synced ${catalog.stats.captures} captures to Prisma.`);
    } catch (error) {
      database = "failed";
      databaseError = error instanceof Error ? error.message : "Prisma sync failed.";
      log(`Prisma sync failed: ${databaseError}`);
    }
  } else if (!databaseConfigured()) {
    log("Standard database skipped. Set DATABASE_URL, then run npm run ingest again.");
  }

  if (!options.upload) {
    log("Blob import waits until the Vercel site exists. Then run npm run import:blob.");
  }

  log(
    `${catalog.stats.captures} captures · ${catalog.stats.images} images · ${catalog.stats.videos} videos · ${catalog.stats.livePhotos} live photos · ${formatBytesInline(catalog.stats.bytes)}`,
  );

  return {
    catalog,
    wroteCatalog,
    database,
    blob,
    databaseError,
    uploaded,
    uploadFailed,
  };
}

function earliest(values: Array<string | null>): string | null {
  const stamps = values.filter((value): value is string => Boolean(value)).sort();
  return stamps[0] ?? null;
}

function compareCaptures(a: CatalogCapture, b: CatalogCapture): number {
  if (a.capturedAt && b.capturedAt && a.capturedAt !== b.capturedAt) {
    return a.capturedAt < b.capturedAt ? 1 : -1;
  }
  if (a.capturedAt && !b.capturedAt) return -1;
  if (!a.capturedAt && b.capturedAt) return 1;
  return b.basename.localeCompare(a.basename);
}

async function readCatalog(catalogPath: string): Promise<CatalogFile | null> {
  try {
    const raw = await readFile(catalogPath, "utf8");
    const parsed = JSON.parse(raw) as CatalogFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.captures)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCatalog(catalogPath: string, catalog: CatalogFile): Promise<void> {
  await mkdir(path.dirname(catalogPath), { recursive: true });
  const temporary = `${catalogPath}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog, null, 2));
  await rename(temporary, catalogPath);
}

function formatBytesInline(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
