import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { summarize, type CatalogAsset, type CatalogFile } from "@/lib/catalog";

const FILE = path.join("data", "catalog.json");

export async function rememberLocalAsset(asset: CatalogAsset, capture: string, sourceDir: string): Promise<void> {
  const catalog = await readCatalog(sourceDir);
  let group = catalog.captures.find((item) => item.basename === capture);
  if (!group) {
    group = { basename: capture, capturedAt: asset.capturedAt, assets: [] };
    catalog.captures.unshift(group);
  }
  const index = group.assets.findIndex((item) => item.sourcePath === asset.sourcePath);
  if (index >= 0) group.assets[index] = asset;
  else group.assets.push(asset);
  group.capturedAt ??= asset.capturedAt;
  catalog.generatedAt = new Date().toISOString();
  catalog.stats = summarize(catalog.captures);
  const temporary = `${FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog, null, 2));
  await rename(temporary, FILE);
}

async function readCatalog(sourceDir: string): Promise<CatalogFile> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as CatalogFile;
    if (parsed?.version === 1 && Array.isArray(parsed.captures)) return parsed;
  } catch {
    // A missing catalog starts empty so the saved file can still be shown.
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceDir,
    stats: summarize([]),
    captures: [],
  };
}
