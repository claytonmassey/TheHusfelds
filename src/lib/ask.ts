import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { mapPool } from "@/ingest/hash";
import { correctionMemory, readCorrections } from "@/lib/corrections";
import { familyMemory } from "@/lib/photo-types";
import { readPeople } from "@/lib/photo-record";
import { upstashVectorCredentials } from "@/lib/prisma";

export type AskMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskSource = {
  filename: string;
  capture: string;
  score: number;
};

export type AskResult = {
  answer: string;
  sources: AskSource[];
};

const TOP_K = 8;
const PASSAGE_CHARS = 4000;
const NOTE_CACHE = path.join("data", "relationship-notes.json");
const FAMILY_PAGE = /family|husband|wife|father|mother|\bchild|born|birth|married|marriage|daughter|\bson\b|buried|death|parent|spouse|genealog/i;

export async function askLibrary(input: unknown): Promise<AskResult> {
  const messages = parseMessages(input);
  const question = messages[messages.length - 1]?.content ?? "";
  const credentials = upstashVectorCredentials();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!credentials) throw new Error("Upstash Vector is not configured.");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  if (asksForLineage(question)) {
    return answerLineage(messages, credentials, apiKey);
  }

  const [vector] = await embed([question], apiKey);
  const sources = await search(credentials, vector, TOP_K);
  if (sources.length === 0) {
    return {
      answer: "Nothing is stored in Upstash yet, so there are no pages to search.",
      sources: [],
    };
  }

  const answer = await complete(messages, sources, apiKey, 900);
  return { answer, sources: publicSources(sources) };
}

export function asksForLineage(question: string): boolean {
  return /lineage|family tree|pedigree|ancestr|descendant|ancestor|genealog|relatives|whole family|who(?:'s| is| are)\b.{0,48}\b(related|family|people)/i.test(
    question,
  );
}

export function parseMessages(input: unknown): AskMessage[] {
  const messages = (input as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Send a question.");
  }
  const parsed: AskMessage[] = messages.slice(-8).map((message) => {
    const row = message as { role?: unknown; content?: unknown };
    if (row.role !== "user" && row.role !== "assistant") throw new Error("Send a question.");
    if (typeof row.content !== "string") throw new Error("Send a question.");
    const content = row.content.trim().slice(0, 4000);
    if (!content) throw new Error("Send a question.");
    return { role: row.role, content };
  });
  if (parsed[parsed.length - 1]?.role !== "user") throw new Error("Send a question.");
  return parsed;
}

type Passage = AskSource & { text: string; kind: string };

type NoteCache = Record<string, { chars: number; notes: string }>;

async function answerLineage(
  messages: AskMessage[],
  credentials: { url: string; token: string },
  apiKey: string,
): Promise<AskResult> {
  const pages = (await loadIndexedPages(credentials)).filter((page) => FAMILY_PAGE.test(page.text));
  if (pages.length === 0) {
    return {
      answer: "The indexed pages do not contain family records to build a lineage from.",
      sources: [],
    };
  }

  const notes = await relationshipNotes(pages, apiKey);
  if (!notes.trim()) {
    return {
      answer: "The family pages could not be read just now. Ask again in a moment.",
      sources: [],
    };
  }
  const answer = await complete(
    messages,
    [{ filename: "Family facts", capture: "", score: 1, kind: "", text: notes }],
    apiKey,
    3000,
    "Construct the lineage these facts support. Group people into families with parents, spouses, and children. Keep dates, places, and spellings as written. When two spellings may be the same person, say so. When a link is missing, say the papers do not show it. Corrected family memory wins over these facts. Cite the filename on each fact you use.",
  );
  return { answer, sources: sourcesNamedIn(answer, pages) };
}

async function relationshipNotes(pages: Passage[], apiKey: string): Promise<string> {
  const cache = await readNoteCache();
  const pending = pages.filter((page) => cache[page.filename]?.chars !== page.text.length);
  const batches = pack(pending, 12000);
  let writing = Promise.resolve();
  await mapPool(batches, 4, async (batch) => {
    try {
      const extracted = await chat(
        [
          {
            role: "system",
            content:
              "Extract every person and family relationship from these transcriptions. For each page, start a section with ### and the filename. Under it, write one bullet per fact: name, role, the person they connect to, date, and place, as written. Keep [unclear]. Skip a page when it has no people. Do not connect people across different pages.",
          },
          {
            role: "user",
            content: batch.map((page) => `### ${page.filename}\n${page.text.slice(0, 4500)}`).join("\n\n"),
          },
        ],
        apiKey,
        1600,
      );
      for (const page of batch) {
        cache[page.filename] = { chars: page.text.length, notes: sectionFor(extracted, page.filename) };
      }
      writing = writing.then(() => writeFile(NOTE_CACHE, JSON.stringify(cache)));
      await writing;
    } catch {
      // This batch is skipped. A later question tries those pages again.
    }
  });

  const notes = pages
    .map((page) => cache[page.filename]?.notes)
    .filter((note): note is string => Boolean(note))
    .join("\n\n");
  if (notes.length <= 140000) return notes;
  return chat(
    [
      {
        role: "system",
        content:
          "Merge these family facts into one list grouped by family. Keep names, dates, places, relationships, and filenames. Drop exact duplicates. Do not add people who are not in the facts.",
      },
      { role: "user", content: notes.slice(0, 90000) },
    ],
    apiKey,
    3000,
  );
}

function sectionFor(extracted: string, filename: string): string {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`###\\s+${escaped}\\s*`, "i").exec(extracted);
  if (!match) return "";
  const rest = extracted.slice(match.index + match[0].length);
  const next = rest.search(/\n###\s+\S+/);
  return (next === -1 ? rest : rest.slice(0, next)).trim().slice(0, 1200);
}

function pack(pages: Passage[], budget: number): Passage[][] {
  const batches: Passage[][] = [];
  let current: Passage[] = [];
  let size = 0;
  for (const page of pages) {
    const length = Math.min(page.text.length, 4500) + page.filename.length;
    if (current.length > 0 && size + length > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(page);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function loadIndexedPages(credentials: { url: string; token: string }): Promise<Passage[]> {
  const pages: Passage[] = [];
  let cursor = "0";
  const seen = new Set<string>();
  for (let page = 0; page < 30 && !seen.has(cursor); page += 1) {
    seen.add(cursor);
    const response = await fetch(`${credentials.url}/range`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cursor, limit: 100, includeMetadata: true, includeVectors: false }),
    });
    if (!response.ok) break;
    const payload = (await response.json()) as { result?: { nextCursor?: string; vectors?: unknown[] } };
    const vectors = payload.result?.vectors ?? [];
    for (const row of vectors) {
      const vector = row as { id?: string; metadata?: Record<string, unknown> };
      const text = stringMeta(vector.metadata, "description");
      const filename = stringMeta(vector.metadata, "filename") || vector.id || "";
      if (!text || !filename) continue;
      pages.push({
        filename,
        capture: stringMeta(vector.metadata, "capture") || filename.replace(/\.[^.]+$/, ""),
        score: 1,
        kind: stringMeta(vector.metadata, "kind"),
        text,
      });
    }
    const next = payload.result?.nextCursor;
    if (!next || vectors.length === 0) break;
    cursor = String(next);
  }
  return dedupePages(pages);
}

function dedupePages(pages: Passage[]): Passage[] {
  const best = new Map<string, Passage>();
  for (const page of pages) {
    const current = best.get(page.capture);
    if (!current || preferPage(page, current)) best.set(page.capture, page);
  }
  return [...best.values()];
}

function preferPage(page: Passage, current: Passage): boolean {
  const pageIsImage = page.kind === "IMAGE" || /\.(hei[cf]|png|jpe?g)$/i.test(page.filename);
  const currentIsImage = current.kind === "IMAGE" || /\.(hei[cf]|png|jpe?g)$/i.test(current.filename);
  if (page.text.length > current.text.length * 1.15) return true;
  return pageIsImage && !currentIsImage && page.text.length > current.text.length * 0.8;
}

function sourcesNamedIn(answer: string, pages: Passage[]): AskSource[] {
  const wanted = new Set((answer.match(/IMG_\d+\.(?:HEIC|MOV|PNG|JPE?G)/gi) ?? []).map((name) => name.toUpperCase()));
  const named = pages.filter((page) => wanted.has(page.filename.toUpperCase()));
  return publicSources(named.slice(0, 24));
}

function publicSources(pages: Passage[]): AskSource[] {
  return pages.map((page) => ({ filename: page.filename, capture: page.capture, score: page.score }));
}

async function readNoteCache(): Promise<NoteCache> {
  try {
    return JSON.parse(await readFile(NOTE_CACHE, "utf8")) as NoteCache;
  } catch {
    return {};
  }
}

async function search(credentials: { url: string; token: string }, vector: number[], topK: number): Promise<Passage[]> {
  const response = await fetch(`${credentials.url}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ vector, topK, includeMetadata: true }),
  });
  if (!response.ok) {
    throw new Error(`Upstash search failed (${response.status}). ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { result?: unknown };
  const rows = Array.isArray(payload.result) ? payload.result : [];
  return rows.flatMap((row) => {
    const match = row as { score?: unknown; metadata?: Record<string, unknown> };
    const text = stringMeta(match.metadata, "description");
    const filename = stringMeta(match.metadata, "filename");
    if (!text || !filename) return [];
    return [
      {
        filename,
        capture: stringMeta(match.metadata, "capture"),
        score: typeof match.score === "number" ? match.score : 0,
        kind: stringMeta(match.metadata, "kind"),
        text: text.slice(0, PASSAGE_CHARS),
      },
    ];
  });
}

async function complete(
  messages: AskMessage[],
  sources: Passage[],
  apiKey: string,
  maxTokens: number,
  task = "Answer the question from these pages. State a parent, child, or spouse only when a page or a corrected fact says so. People named in the same note are not automatically a family.",
): Promise<string> {
  const passages = sources
    .map((source, index) => `[${index + 1}] ${source.filename}\n${source.text}`)
    .join("\n\n");
  const memory = correctionMemory(await readCorrections());
  const tree = familyMemory(await readPeople());
  return chat(
    [
      {
        role: "system",
        content: [
          "You answer questions about photographed family papers. Use the corrected family memory, the family tree, and the records below. Quote names, dates, and places as written.",
          memory,
          tree,
          task,
          "Lines labeled Context added by the family are notes written about that page, including types, categories, and people tagged on the photo. Prefer them when they conflict with the transcription. Family tree lines replace only the parent link they name. If neither the corrected memory, the family tree, nor the records contain the relevant facts, say you cannot find it in the indexed pages. Corrected memory replaces only the relationship it names. The answer must also include the other facts the numbered pages state about that person, including work, places, and events. Name the filename of each page you use.",
          passages,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      ...messages,
    ],
    apiKey,
    maxTokens,
  );
}

async function chat(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed. ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("GPT returned no answer.");
  return answer;
}

async function embed(input: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed. ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
  const rows = payload.data ?? [];
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

function stringMeta(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}
