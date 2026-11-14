import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset, CatalogFile } from "@/lib/catalog";
import { getPrisma } from "@/lib/prisma";
import { publishTranscript } from "@/lib/publish-transcript";

export type ImageNote = {
  sourcePath: string;
  filename: string;
  note: string;
  updatedAt: string;
};

const FILE = path.join("data", "image-context.json");
const CONTEXT_MARKER = "\n\nContext added by the family:\n";

export async function readImageNotes(): Promise<Record<string, ImageNote>> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, ImageNote>;
  } catch {
    return {};
  }
}

export async function saveImageNote(sourcePath: string, note: string): Promise<ImageNote> {
  const trimmed = note.trim().slice(0, 2000);
  if (!sourcePath || sourcePath.includes("..")) throw new Error("Choose a photo.");
  if (!trimmed) throw new Error("Write what you know about this photo.");

  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL is not set.");
  const row = await prisma.asset.findUnique({ where: { sourcePath }, include: { capture: true } });
  if (!row || row.kind !== "IMAGE") throw new Error("That photo is not in the library.");

  const saved: ImageNote = {
    sourcePath,
    filename: row.filename,
    note: trimmed,
    updatedAt: new Date().toISOString(),
  };
  const notes = await readImageNotes();
  notes[sourcePath] = saved;
  await writeFile(FILE, JSON.stringify(notes, null, 2));

  await republishImageContext(sourcePath, trimmed);
  return saved;
}

export async function republishImageContext(sourcePath: string, familyContext: string): Promise<void> {
  if (!sourcePath || sourcePath.includes("..")) throw new Error("Choose a photo.");
  const { asset, capture } = await libraryImage(sourcePath);

  const prior = await readCheckpointDescription(sourcePath);
  const transcript = prior.includes(CONTEXT_MARKER) ? prior.slice(0, prior.indexOf(CONTEXT_MARKER)) : prior;
  const addition = familyContext.trim();
  const description = addition ? `${transcript.trim()}${CONTEXT_MARKER}${addition}`.trim() : transcript.trim();
  await publishTranscript(asset, capture, description);
}

async function libraryImage(sourcePath: string): Promise<{ asset: CatalogAsset; capture: string }> {
  try {
    const catalog = JSON.parse(await readFile(path.join("data", "catalog.json"), "utf8")) as CatalogFile;
    for (const capture of catalog.captures) {
      const asset = capture.assets.find((item) => item.sourcePath === sourcePath && item.kind === "IMAGE");
      if (asset) return { asset, capture: capture.basename };
    }
  } catch {
    // A missing local catalog still leaves the database lookup below.
  }

  const prisma = getPrisma();
  if (!prisma) throw new Error("That photo is not in the library.");
  const row = await prisma.asset.findUnique({ where: { sourcePath }, include: { capture: true } });
  if (!row || row.kind !== "IMAGE") throw new Error("That photo is not in the library.");
  return { asset: toCatalogAsset(row), capture: row.capture.basename };
}

export async function readPageTranscript(sourcePath: string): Promise<string> {
  const full = await readCheckpointDescription(sourcePath);
  const cut = full.indexOf(CONTEXT_MARKER);
  return (cut >= 0 ? full.slice(0, cut) : full).trim();
}

async function readCheckpointDescription(sourcePath: string): Promise<string> {
  try {
    const memory = JSON.parse(await readFile(path.join("data", "understandings.json"), "utf8")) as Record<
      string,
      { description?: string }
    >;
    return memory[sourcePath]?.description ?? "";
  } catch {
    return "";
  }
}

function toCatalogAsset(row: {
  sourcePath: string;
  filename: string;
  extension: string;
  kind: CatalogAsset["kind"];
  mimeType: string;
  byteSize: bigint;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: Date | null;
  sourceModified: Date;
  blobUrl: string | null;
  blobPathname: string | null;
  status: CatalogAsset["status"];
  error: string | null;
}): CatalogAsset {
  return {
    sourcePath: row.sourcePath,
    filename: row.filename,
    extension: row.extension,
    kind: row.kind,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    sourceModified: row.sourceModified.toISOString(),
    blobUrl: row.blobUrl,
    blobPathname: row.blobPathname,
    status: row.status,
    error: row.error,
  };
}
