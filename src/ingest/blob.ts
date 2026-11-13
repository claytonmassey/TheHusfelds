import { createReadStream } from "node:fs";
import path from "node:path";

import type { CatalogAsset } from "../lib/catalog";

export function blobPathnameFor(asset: Pick<CatalogAsset, "sha256" | "extension">): string {
  const extension = asset.extension || "bin";
  return `media/${asset.sha256}.${extension}`;
}

export async function uploadToBlob(
  absolutePath: string,
  asset: CatalogAsset,
  token: string,
): Promise<{ url: string; pathname: string }> {
  const { put } = await import("@vercel/blob");
  const pathname = blobPathnameFor(asset);
  const blob = await put(pathname, createReadStream(absolutePath), {
    access: "private",
    token,
    contentType: asset.mimeType,
    multipart: true,
    allowOverwrite: true,
    addRandomSuffix: false,
  });

  return { url: blob.url, pathname: blob.pathname };
}

export function absoluteFromSource(sourceDir: string, relativePath: string): string {
  return path.join(sourceDir, ...relativePath.split("/"));
}
