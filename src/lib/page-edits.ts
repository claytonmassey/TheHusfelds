import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PageEdit = {
  id: string;
  by: string;
  at: string;
  text: string;
};

const FILE = path.join("data", "page-edits.json");

export function assertPagePath(sourcePath: string): string {
  const trimmed = sourcePath.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error("Choose a photo.");
  }
  return trimmed;
}

export async function readPageEdits(sourcePath: string): Promise<PageEdit[]> {
  const key = assertPagePath(sourcePath);
  const all = await readAll();
  return (all[key] ?? []).filter(isEdit);
}

export async function addPageEdit(sourcePath: string, text: string, by: string): Promise<PageEdit[]> {
  const key = assertPagePath(sourcePath);
  const next = text.trim().slice(0, 2000);
  const name = by.trim();
  if (!next) throw new Error("Write the detail.");
  if (!name) throw new Error("Log in to edit this page.");
  const all = await readAll();
  const edits = (all[key] ?? []).filter(isEdit);
  if (edits[edits.length - 1]?.text === next) throw new Error("That detail is already saved.");
  edits.push({ id: randomUUID(), by: name, at: new Date().toISOString(), text: next });
  all[key] = edits;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
  return edits;
}

async function readAll(): Promise<Record<string, PageEdit[]>> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, PageEdit[]>;
  } catch {
    return {};
  }
}

function isEdit(value: PageEdit): boolean {
  return Boolean(value && typeof value.text === "string" && typeof value.by === "string" && typeof value.at === "string");
}
