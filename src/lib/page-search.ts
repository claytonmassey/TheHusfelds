import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertPagePath } from "@/lib/page-edits";

export type PageHit = {
  filename: string;
  excerpt: string;
};

const FILE = path.join("data", "understandings.json");

export async function searchTranscripts(term: string, exceptPath: string): Promise<PageHit[]> {
  const needle = term.trim().replace(/\s+/g, " ");
  if (needle.length < 4 || needle.length > 80) return [];
  let except = "";
  try {
    except = assertPagePath(exceptPath);
  } catch {
    except = "";
  }
  let memory: Record<string, { description?: string }> = {};
  try {
    memory = JSON.parse(await readFile(FILE, "utf8")) as typeof memory;
  } catch {
    return [];
  }
  const folded = needle.toLowerCase();
  const hits: PageHit[] = [];
  for (const [key, row] of Object.entries(memory)) {
    if (key === except || key.includes("..")) continue;
    const body = (row.description ?? "").split("Context added by the family:")[0];
    const excerpt = sentenceAt(body, folded);
    if (!excerpt) continue;
    const filename = key.split("/").pop() || key;
    const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
    if (hits.some((hit) => hit.filename.replace(/\.[^.]+$/, "").toLowerCase() === stem)) continue;
    hits.push({ filename, excerpt });
    if (hits.length === 2) break;
  }
  return hits;
}

function sentenceAt(text: string, needle: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(needle);
  if (at < 0) return "";
  const period = clean.lastIndexOf(". ", at);
  const start = period >= 0 ? period + 2 : 0;
  let end = clean.indexOf(". ", at);
  if (end < 0) end = Math.min(clean.length, at + needle.length + 140);
  else end += 1;
  const sentence = clean.slice(start, end).trim();
  if (!sentence) return "";
  if (sentence.length <= 220) return sentence;
  return `${sentence.slice(0, 217).replace(/\s+\S*$/, "")}…`;
}
