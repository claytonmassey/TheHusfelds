import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { summarize, type CatalogFile } from "@/lib/catalog";
import { loadCatalog } from "@/lib/load-catalog";
import { previewPathname } from "@/lib/image-preview";
import { forgetPhoto } from "@/lib/photo-record";
import { getPrisma, upstashVectorCredentials } from "@/lib/prisma";

const CATALOG = path.join("data", "catalog.json");
const TRANSCRIPTS = path.join("data", "understandings.json");
const NOTES = path.join("data", "image-context.json");

export async function removeKnowledgeDocument(sourcePath: string): Promise<void> {
  if (!sourcePath || sourcePath.includes("..") || sourcePath.startsWith("/") || sourcePath.includes("\\")) {
    throw new Error("Choose a document.");
  }
  const loaded = await loadCatalog();
  const asset = loaded.catalog?.captures.flatMap((capture) => capture.assets).find((item) => item.sourcePath === sourcePath);
  if (!asset || (asset.kind !== "IMAGE" && asset.extension !== "pdf" && asset.extension !== "txt")) {
    throw new Error("That document is not in the library.");
  }

  const removedFromDatabase = await removeFromDatabase(sourcePath);
  await removeFromLocalCatalog(sourcePath);
  if (loaded.source === "database" && !removedFromDatabase) {
    throw new Error("That document could not be removed.");
  }

  await dropKey(TRANSCRIPTS, sourcePath);
  await dropKey(NOTES, sourcePath);
  await forgetPhoto(sourcePath);
  if (sourcePath.startsWith("uploads/")) await removeUploadFile(sourcePath);
  await removeVector(sourcePath);
  if (asset.blobPathname) await removeBlob(asset.blobPathname);
  if (asset.kind === "IMAGE") {
    await removeBlob(previewPathname(asset.sha256, 480));
    await removeBlob(previewPathname(asset.sha256, 1600));
  }
}

async function removeFromDatabase(sourcePath: string): Promise<boolean> {
  const prisma = getPrisma();
  if (!prisma) return false;
  const asset = await prisma.asset.findUnique({ where: { sourcePath } });
  if (!asset) return true;
  await prisma.asset.delete({ where: { sourcePath } });
  const remaining = await prisma.asset.count({ where: { captureId: asset.captureId } });
  if (remaining === 0) await prisma.capture.delete({ where: { id: asset.captureId } });
  return true;
}

async function removeFromLocalCatalog(sourcePath: string): Promise<void> {
  let catalog: CatalogFile;
  try {
    catalog = JSON.parse(await readFile(CATALOG, "utf8")) as CatalogFile;
  } catch {
    return;
  }
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.captures)) return;
  catalog.captures = catalog.captures.flatMap((capture) => {
    const assets = capture.assets.filter((asset) => asset.sourcePath !== sourcePath);
    return assets.length > 0 ? [{ ...capture, assets }] : [];
  });
  catalog.generatedAt = new Date().toISOString();
  catalog.stats = summarize(catalog.captures);
  await writeFile(CATALOG, JSON.stringify(catalog, null, 2));
}

async function dropKey(file: string, key: string): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !(key in parsed)) return;
    delete parsed[key];
    await writeFile(file, JSON.stringify(parsed, null, 2));
  } catch {
    // A missing notes or transcript file has nothing to remove.
  }
}

async function removeUploadFile(sourcePath: string): Promise<void> {
  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  const absolute = path.resolve(sourceDir, sourcePath);
  if (absolute !== sourceDir && absolute.startsWith(`${sourceDir}${path.sep}`)) {
    await rm(absolute, { force: true });
  }
}

async function removeVector(sourcePath: string): Promise<void> {
  const credentials = upstashVectorCredentials();
  if (!credentials) return;
  try {
    await fetch(`${credentials.url}/delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [sourcePath] }),
    });
  } catch {
    // The library list is already updated when the search index cannot be reached.
  }
}

async function removeBlob(pathname: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !pathname) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(pathname, { token });
  } catch {
    // The file can remain in storage if the token cannot delete it.
  }
}
