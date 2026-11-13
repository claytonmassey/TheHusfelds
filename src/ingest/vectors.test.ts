import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogAsset } from "../lib/catalog";
import { vectorCandidates } from "./vectors";

test("vector ingest only accepts images and videos that already live in Blob", () => {
  const assets: CatalogAsset[] = [
    asset({ sourcePath: "IMG_0001.HEIC", kind: "IMAGE", status: "UPLOADED", blobUrl: "https://blob/1", blobPathname: "media/1.heic" }),
    asset({ sourcePath: "IMG_0001.MOV", kind: "VIDEO", status: "CATALOGED", blobUrl: null, blobPathname: null }),
    asset({ sourcePath: "IMG_9780.AAE", kind: "SIDECAR", status: "UPLOADED", blobUrl: "https://blob/aae", blobPathname: "media/aae.xml" }),
    asset({ sourcePath: "IMG_0002.HEIC", kind: "IMAGE", status: "CATALOGED", blobUrl: null, blobPathname: null }),
  ];

  const ready = vectorCandidates(assets);
  assert.deepEqual(
    ready.map((item) => item.sourcePath),
    ["IMG_0001.HEIC"],
  );
});

function asset(overrides: Partial<CatalogAsset> & Pick<CatalogAsset, "sourcePath" | "kind" | "status">): CatalogAsset {
  return {
    filename: overrides.sourcePath,
    extension: "heic",
    mimeType: "image/heic",
    byteSize: 10,
    sha256: "a".repeat(64),
    width: null,
    height: null,
    durationMs: null,
    capturedAt: null,
    sourceModified: "2026-07-13T00:00:00.000Z",
    blobUrl: null,
    blobPathname: null,
    error: null,
    ...overrides,
  };
}
