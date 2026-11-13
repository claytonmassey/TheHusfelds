export type MediaKind = "IMAGE" | "VIDEO" | "SIDECAR" | "OTHER";

export type IngestStatus = "CATALOGED" | "UPLOADED" | "FAILED";

export type CatalogAsset = {
  sourcePath: string;
  filename: string;
  extension: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
  sourceModified: string;
  blobUrl: string | null;
  blobPathname: string | null;
  status: IngestStatus;
  error: string | null;
};

export type CatalogCapture = {
  basename: string;
  capturedAt: string | null;
  assets: CatalogAsset[];
};

export type CatalogStats = {
  files: number;
  captures: number;
  images: number;
  videos: number;
  sidecars: number;
  livePhotos: number;
  stills: number;
  bytes: number;
  uploaded: number;
  failed: number;
};

export type CatalogFile = {
  version: 1;
  generatedAt: string;
  sourceDir: string;
  stats: CatalogStats;
  captures: CatalogCapture[];
};

export function summarize(captures: CatalogCapture[]): CatalogStats {
  const assets = captures.flatMap((capture) => capture.assets);
  const livePhotos = captures.filter((capture) => hasKind(capture, "IMAGE") && hasKind(capture, "VIDEO")).length;
  const stills = captures.filter((capture) => hasKind(capture, "IMAGE") && !hasKind(capture, "VIDEO")).length;

  return {
    files: assets.length,
    captures: captures.length,
    images: assets.filter((asset) => asset.kind === "IMAGE").length,
    videos: assets.filter((asset) => asset.kind === "VIDEO").length,
    sidecars: assets.filter((asset) => asset.kind === "SIDECAR").length,
    livePhotos,
    stills,
    bytes: assets.reduce((total, asset) => total + asset.byteSize, 0),
    uploaded: assets.filter((asset) => asset.status === "UPLOADED").length,
    failed: assets.filter((asset) => asset.status === "FAILED").length,
  };
}

export function hasKind(capture: CatalogCapture, kind: MediaKind): boolean {
  return capture.assets.some((asset) => asset.kind === kind);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "—";
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes === 0) return `${rounded}s`;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}
