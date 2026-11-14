import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogAsset } from "@/lib/catalog";
import { loadCatalog } from "@/lib/load-catalog";
import { readImageNotes } from "@/lib/image-context";
import { pageParagraphs, pageSummary } from "@/lib/page-text";
import { currentAccountId } from "@/lib/accounts";
import { readPhotoMarks } from "@/lib/photo-record";

export type GalleryImage = {
  sourcePath: string;
  filename: string;
  capture: string;
  capturedAt: string | null;
  note: string;
  people: string;
  families: string[];
  rotation: number;
  group: "photo" | "writing";
  tagged: boolean;
  removable: boolean;
};

export type KnowledgeItem = {
  sourcePath: string;
  filename: string;
  extension: string;
  kind: CatalogAsset["kind"];
  addedAt: string;
  label: string;
  summary: string;
  scanned: boolean;
  thumb: boolean;
  removable: boolean;
};

export async function loadGallery(): Promise<GalleryImage[]> {
  const accountId = await currentAccountId();
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
        people: marks[asset.sourcePath]?.people ?? "",
        families: marks[asset.sourcePath]?.families ?? [],
        rotation: marks[asset.sourcePath]?.rotation ?? 0,
        group: galleryGroup(transcripts[asset.sourcePath] ?? ""),
        tagged: marks[asset.sourcePath]?.tagged || Boolean(notes[asset.sourcePath]?.note),
        removable: ownsUpload(accountId, asset.uploadedBy),
      })),
  );
  return images.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "") || a.filename.localeCompare(b.filename));
}

export async function loadKnowledge(): Promise<KnowledgeItem[]> {
  const accountId = await currentAccountId();
  const loaded = await loadCatalog();
  const transcripts = await readTranscripts();
  const items = (loaded.catalog?.captures ?? []).flatMap((capture) =>
    capture.assets.filter(isDocument).map((asset) => {
      const transcript = pageTranscript(transcripts[asset.sourcePath] ?? "");
      const summary = transcript ? pageSummary(pageParagraphs(transcript)) : "";
      return {
        sourcePath: asset.sourcePath,
        filename: asset.filename,
        extension: asset.extension,
        kind: asset.kind,
        addedAt: asset.sourceModified,
        label: documentLabel(transcript),
        summary: summary.length > 180 ? `${summary.slice(0, 177).replace(/\s+\S*$/, "")}…` : summary,
        scanned: Boolean(transcript),
        thumb: asset.kind === "IMAGE",
        removable: asset.kind === "IMAGE" ? ownsUpload(accountId, asset.uploadedBy) : true,
      };
    }),
  );
  return items.sort((left, right) => Number(right.scanned) - Number(left.scanned) || left.filename.localeCompare(right.filename));
}

function ownsUpload(accountId: string | null, uploadedBy: string | null | undefined): boolean {
  return Boolean(accountId && uploadedBy && accountId === uploadedBy);
}

function isDocument(asset: CatalogAsset): boolean {
  if (asset.kind === "IMAGE") return true;
  return asset.extension === "pdf" || asset.extension === "txt";
}

function pageTranscript(value: string): string {
  const cut = value.indexOf("\n\nContext added by the family:\n");
  return (cut >= 0 ? value.slice(0, cut) : value).trim();
}

export function documentLabel(transcript: string): string {
  const text = transcript.trim();
  if (!text) return "Not scanned yet";
  if (/^no text\b/i.test(text)) return "Photograph";
  if (/\bobituary\b|\bfind a grave\b|\bpreceded in death\b|\bsurvived by\b/i.test(text)) return "Obituary";
  if (/\bpost\s?card\b/i.test(text)) return "Postcard";
  if (/\b(dear|sincerely|yours truly)\b/i.test(text)) return "Letter";
  if (/\b(baptism|geburt|tauf|trauung|burial|ledger|census)\b/i.test(text)) return "Record";
  if (galleryGroup(text) === "writing") return "Document";
  return "Photograph";
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
