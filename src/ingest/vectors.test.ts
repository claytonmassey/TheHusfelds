import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogAsset } from "../lib/catalog";
import { vectorCandidates, vectorRecord } from "./vectors";

test("vector records describe images and videos and skip edit sidecars", () => {
  const assets: CatalogAsset[] = [
    asset({
      sourcePath: "IMG_0001.HEIC",
      kind: "IMAGE",
      status: "CATALOGED",
      width: 4284,
      height: 5712,
      capturedAt: "2026-07-13T22:33:50.000Z",
    }),
    asset({ sourcePath: "IMG_0001.MOV", kind: "VIDEO", status: "CATALOGED", durationMs: 1500 }),
    asset({ sourcePath: "IMG_9780.AAE", kind: "SIDECAR", status: "CATALOGED" }),
  ];

  const ready = vectorCandidates(assets);
  assert.deepEqual(
    ready.map((item) => item.sourcePath),
    ["IMG_0001.HEIC", "IMG_0001.MOV"],
  );

  const record = vectorRecord(ready[0], "IMG_0001");
  assert.equal(record.id, "IMG_0001.HEIC");
  assert.match(record.data, /4284 by 5712/);
  assert.match(record.data, /capture IMG_0001/);
  assert.equal(record.metadata.kind, "IMAGE");
  assert.equal(record.metadata.width, 4284);
});

function asset(overrides: Partial<CatalogAsset> & Pick<CatalogAsset, "sourcePath" | "kind" | "status">): CatalogAsset {
  return {
    filename: overrides.sourcePath,
    extension: "heic",
    mimeType: overrides.kind === "VIDEO" ? "video/quicktime" : "image/heic",
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
