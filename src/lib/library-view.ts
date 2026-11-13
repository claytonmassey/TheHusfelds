import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset } from "@/lib/catalog";
import { loadCatalog } from "@/lib/load-catalog";
import { readImageNotes } from "@/lib/image-context";
import { readPhotoMarks } from "@/lib/photo-record";

export type GalleryImage = {
  sourcePath: string;
  filename: string;
  capture: string;
  capturedAt: string | null;
  note: string;
  group: "photo" | "writing";
  tagged: boolean;
};

export type KnowledgeItem = {
  sourcePath: string;
  filename: string;
  extension: string;
  kind: CatalogAsset["kind"];
  addedAt: string;
  excerpt: string;
  note: string;
};

export async function loadGallery(): Promise<GalleryImage[]> {
  const loaded = await loadCatalog();
  const notes = await readImageNotes();
  const marks = await readPhotoMarks();
  const transcripts = await readTranscripts();
  const images = (loaded.catalog?.captures ?? []).flatMap((capture) =>
    capture.assets
      .filter((asset) => asset.kind === "IMAGE")
      .map((asset) => ({
        sourcePath: asset.sourcePath,
        filename: asset.filename,
        capture: capture.basename,
        capturedAt: asset.capturedAt ?? capture.capturedAt,
        note: marks[asset.sourcePath]?.note || notes[asset.sourcePath]?.note || "",
        group: galleryGroup(transcripts[asset.sourcePath] ?? ""),
        tagged: marks[asset.sourcePath]?.tagged || Boolean(notes[asset.sourcePath]?.note),
      })),
  );
  return images.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "") || a.filename.localeCompare(b.filename));
}

export async function loadKnowledge(): Promise<KnowledgeItem[]> {
  const loaded = await loadCatalog();
  const notes = await readImageNotes();
  const transcripts = await readTranscripts();
  const items = (loaded.catalog?.captures ?? []).flatMap((capture) =>
    capture.assets
      .filter((asset) => asset.sourcePath.startsWith("uploads/"))
      .map((asset) => ({
        sourcePath: asset.sourcePath,
        filename: asset.filename,
        extension: asset.extension,
        kind: asset.kind,
        addedAt: asset.sourceModified,
        excerpt: excerptFor(transcripts[asset.sourcePath] ?? ""),
        note: notes[asset.sourcePath]?.note ?? "",
      })),
  );
  return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

const WRITING = /\b(dear|sincerely|post\s?card|correspondence|family group|husband|wife|geburt|baptism|burial|gestorben|patient|ledger|obituary|tauf|trauung)\b/i;
const CAPTION = /\b(back row|front row|left to right|reunion)\b/i;

export function galleryGroup(transcript: string): "photo" | "writing" {
  const text = transcript.trim();
  if (!text || /^no text\b/i.test(text)) return "photo";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (CAPTION.test(text) && text.length < 700 && lines.length <= 12) return "photo";
  if (lines.length <= 8 && text.length <= 320 && !WRITING.test(text)) return "photo";
  return "writing";
}

function excerptFor(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 280) return clean;
  return `${clean.slice(0, 277)}…`;
}

async function readTranscripts(): Promise<Record<string, string>> {
  try {
    const memory = JSON.parse(await readFile(path.join("data", "understandings.json"), "utf8")) as Record<
      string,
      { description?: string }
    >;
    return Object.fromEntries(Object.entries(memory).map(([key, value]) => [key, value.description ?? ""]));
  } catch {
    return {};
  }
}
