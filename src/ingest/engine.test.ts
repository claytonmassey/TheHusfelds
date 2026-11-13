import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { captureKeyFor, groupFiles, kindFor } from "./files";
import { parseMdlsPlist } from "./metadata";
import { runIngest } from "./engine";

test("groups a Live Photo, a still, and an edit sidecar by capture", () => {
  const files = [
    file("IMG_0001.HEIC"),
    file("IMG_0001.MOV"),
    file("IMG_0085.HEIC"),
    file("IMG_9780.HEIC"),
    file("IMG_9780.MOV"),
    file("IMG_9780.AAE"),
    file("IMG_9776.PNG"),
    file("album/IMG_0001.HEIC"),
  ].map((relativePath) => ({ relativePath }));

  const groups = groupFiles(files);
  assert.equal(groups.size, 5);
  assert.deepEqual(
    groups.get("IMG_0001")?.map((entry) => entry.relativePath).sort(),
    ["IMG_0001.HEIC", "IMG_0001.MOV"],
  );
  assert.equal(groups.get("IMG_9780")?.length, 3);
  assert.equal(groups.get("album/IMG_0001")?.length, 1);
  assert.equal(captureKeyFor("IMG_9776.PNG"), "IMG_9776");
  assert.equal(kindFor("heic"), "IMAGE");
  assert.equal(kindFor("mov"), "VIDEO");
  assert.equal(kindFor("aae"), "SIDECAR");
});

test("parses Spotlight plist metadata", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
  <dict>
    <key>kMDItemContentCreationDate</key>
    <date>2026-07-13T22:33:50Z</date>
    <key>kMDItemPixelHeight</key>
    <integer>5712</integer>
    <key>kMDItemPixelWidth</key>
    <integer>4284</integer>
  </dict>
  <dict>
    <key>kMDItemContentCreationDate</key>
    <date>2026-07-13T22:33:50Z</date>
    <key>kMDItemDurationSeconds</key>
    <real>1.5</real>
    <key>kMDItemPixelHeight</key>
    <integer>1920</integer>
    <key>kMDItemPixelWidth</key>
    <integer>1440</integer>
  </dict>
</array></plist>`;

  const parsed = parseMdlsPlist(xml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].width, 4284);
  assert.equal(parsed[0].height, 5712);
  assert.equal(parsed[0].durationMs, null);
  assert.equal(parsed[0].capturedAt, "2026-07-13T22:33:50.000Z");
  assert.equal(parsed[1].durationMs, 1500);
  assert.equal(parsed[1].width, 1440);
});

test("ingestion catalogs a folder, pairs files, and skips the database when it is unset", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "husfelds-"));
  const source = path.join(root, "Source");
  const catalogPath = path.join(root, "catalog.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(source));

  const still = Buffer.from("still-bytes");
  const motion = Buffer.from("motion-bytes");
  const other = Buffer.from("other-still");
  await writeFile(path.join(source, "IMG_0002.HEIC"), still);
  await writeFile(path.join(source, "IMG_0002.MOV"), motion);
  await writeFile(path.join(source, "IMG_0009.HEIC"), other);
  await writeFile(path.join(source, ".DS_Store"), Buffer.from("ignore"));

  const previousDatabase = process.env.DATABASE_URL;
  const previousBlob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.DATABASE_URL;
  process.env.BLOB_READ_WRITE_TOKEN = "present-but-ingest-must-not-upload";

  try {
    const result = await runIngest({
      sourceDir: source,
      catalogPath,
      limit: 1,
      log: () => {},
    });

    assert.equal(result.catalog.captures.length, 1);
    assert.equal(result.catalog.captures[0].basename, "IMG_0002");
    assert.equal(result.catalog.stats.images, 1);
    assert.equal(result.catalog.stats.videos, 1);
    assert.equal(result.catalog.stats.livePhotos, 1);
    assert.equal(result.database, "skipped");
    assert.equal(result.blob, "skipped");
    assert.equal(result.wroteCatalog, true);
    assert.equal(
      result.catalog.captures[0].assets.find((asset) => asset.extension === "heic")?.sha256,
      createHash("sha256").update(still).digest("hex"),
    );

    const again = await runIngest({
      sourceDir: source,
      catalogPath,
      limit: 1,
      dryRun: true,
      log: () => {},
    });
    assert.equal(again.wroteCatalog, false);
    assert.equal(again.catalog.captures[0].assets[0].sha256.length, 64);
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousBlob;
    await rm(root, { recursive: true, force: true });
  }
});

function file(relativePath: string): string {
  return relativePath;
}
