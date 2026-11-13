import path from "node:path";

export type ScannedFile = {
  absolutePath: string;
  relativePath: string;
  filename: string;
  extension: string;
  basename: string;
  byteSize: number;
  sourceModified: string;
};

const MIME_TYPES: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  txt: "text/plain",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  aae: "application/xml",
};

const IMAGE_EXTENSIONS = new Set(["heic", "heif", "jpg", "jpeg", "png", "gif", "webp", "tif", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mov", "mp4", "m4v"]);
const SIDECAR_EXTENSIONS = new Set(["aae"]);

export function mimeTypeFor(extension: string): string {
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function kindFor(extension: string): "IMAGE" | "VIDEO" | "SIDECAR" | "OTHER" {
  if (IMAGE_EXTENSIONS.has(extension)) return "IMAGE";
  if (VIDEO_EXTENSIONS.has(extension)) return "VIDEO";
  if (SIDECAR_EXTENSIONS.has(extension)) return "SIDECAR";
  return "OTHER";
}

export function captureKeyFor(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  const directory = path.posix.dirname(normalized);
  const base = path.posix.parse(normalized).name;
  return directory === "." ? base : `${directory}/${base}`;
}

export function groupFiles<T extends { relativePath: string }>(files: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const key = captureKeyFor(file.relativePath);
    const existing = groups.get(key);
    if (existing) existing.push(file);
    else groups.set(key, [file]);
  }
  return groups;
}
