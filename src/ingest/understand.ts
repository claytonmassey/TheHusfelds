import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import type { CatalogAsset } from "../lib/catalog";
import { publishTranscript } from "../lib/publish-transcript";
import { upstashVectorCredentials } from "../lib/prisma";
import { mapPool } from "./hash";
import { loadCaptures, vectorCandidates, vectorRecord } from "./vectors";

export { publishTranscript };

const execFileAsync = promisify(execFile);
const CHECKPOINT = path.join("data", "understandings.json");

type Memory = {
  description: string;
  upserted: boolean;
};

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  data?: Array<{ index: number; embedding: number[] }>;
};

export async function understandLibrary(options: {
  sourceDir?: string;
  catalogPath?: string;
  limit?: number;
  log?: (message: string) => void;
} = {}) {
  const log = options.log ?? ((message: string) => console.log(message));
  const credentials = upstashVectorCredentials();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!credentials) {
    throw new Error("Upstash Vector is not configured.");
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const sourceDir = path.resolve(options.sourceDir ?? process.env.SOURCE_DIR ?? "Source");
  const captures = await loadCaptures(options.catalogPath ?? path.join("data", "catalog.json"));
  let work = captures.flatMap((capture) =>
    vectorCandidates(capture.assets).map((asset) => ({ asset, capture: capture.basename })),
  );
  if (options.limit != null) work = work.slice(0, options.limit);
  if (work.length === 0) throw new Error("The catalog has no images or videos to understand.");

  const memory = await readCheckpoint();
  log(`Transcribing text in ${work.length} files.`);

  let described = 0;
  await mapPool(work, 2, async (item) => {
    const prior = memory[item.asset.sourcePath];
    if (prior?.description) return;
    try {
      const description = await describeFile(sourceDir, item.asset, apiKey);
      if (isRefusal(description)) {
        log(`No transcription for ${item.asset.filename}.`);
        return;
      }
      memory[item.asset.sourcePath] = { description, upserted: false };
      described += 1;
      if (described % 10 === 0) {
        await writeCheckpoint(memory);
        log(`Transcribed ${described} files.`);
      }
    } catch (error) {
      log(`Failed ${item.asset.filename}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  });
  await writeCheckpoint(memory);

  const pending = work.filter((item) => memory[item.asset.sourcePath] && !memory[item.asset.sourcePath].upserted);
  let stored = 0;
  for (let index = 0; index < pending.length; index += 20) {
    const batch = pending.slice(index, index + 20);
    const vectors = await embed(
      batch.map((item) => embeddingText(item.asset, item.capture, memory[item.asset.sourcePath].description)),
      apiKey,
    );
    await upsert(
      credentials,
      batch.map((item, itemIndex) => {
        const record = vectorRecord(item.asset, item.capture);
        return {
          id: record.id,
          vector: vectors[itemIndex],
          metadata: {
            ...record.metadata,
            description: memory[item.asset.sourcePath].description.slice(0, 8000),
          },
        };
      }),
    );
    for (const item of batch) memory[item.asset.sourcePath].upserted = true;
    stored += batch.length;
    await writeCheckpoint(memory);
    log(`Stored ${stored}/${pending.length} in Upstash.`);
  }

  log(`Finished. ${work.length} files are in the vector index.`);
  return { files: work.length, described, stored };
}

export async function rememberTranscript(sourceDir: string, asset: CatalogAsset, capture: string): Promise<string> {
  const credentials = upstashVectorCredentials();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!credentials) throw new Error("Upstash Vector is not configured.");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const memory = await readCheckpoint();
  const prior = memory[asset.sourcePath];
  let description = prior?.description ?? "";
  if (!description) {
    description = asset.extension === "txt" ? await readText(sourceDir, asset) : await describeFile(sourceDir, asset, apiKey);
    if (isRefusal(description)) throw new Error(`No transcription for ${asset.filename}.`);
    memory[asset.sourcePath] = { description, upserted: false };
    await writeCheckpoint(memory);
  }

  if (!memory[asset.sourcePath]?.upserted) {
    await publishTranscript(asset, capture, description);
  }

  return description;
}

async function readText(sourceDir: string, asset: CatalogAsset): Promise<string> {
  const text = await readFile(path.join(sourceDir, ...asset.sourcePath.split("/")), "utf8");
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${asset.filename} has no text.`);
  return trimmed.slice(0, 20000);
}

function embeddingText(asset: CatalogAsset, capture: string, description: string): string {
  return `${vectorRecord(asset, capture).data}. ${description}`;
}

async function describeFile(sourceDir: string, asset: CatalogAsset, apiKey: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "husfelds-"));
  try {
    const jpeg = await previewJpeg(sourceDir, asset, directory, 4096);
    const bytes = await readFile(jpeg);
    return await askVision(bytes, asset, apiKey, async () => readFile(await previewJpeg(sourceDir, asset, directory, 8192)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function previewJpeg(sourceDir: string, asset: CatalogAsset, directory: string, maxEdge: number): Promise<string> {
  const source = path.join(sourceDir, ...asset.sourcePath.split("/"));
  const jpeg = path.join(directory, `preview-${maxEdge}.jpg`);
  if (asset.kind === "IMAGE" || asset.extension === "pdf") {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", String(maxEdge), source, "--out", jpeg]);
    return jpeg;
  }

  await execFileAsync("qlmanage", ["-t", "-s", "2048", "-o", directory, source]);
  const png = path.join(directory, `${path.basename(source)}.png`);
  await execFileAsync("sips", ["-s", "format", "jpeg", png, "--out", jpeg]);
  return jpeg;
}

const TRANSCRIBE_PROMPT = [
  "Transcribe the document in this photo.",
  "Write every line you can read, in reading order. If two pages are open, finish the left page from top to bottom, then the right page.",
  "Do not summarize. Do not skip a line. Do not replace a passage with ellipses or [...].",
  "If one word cannot be read, write [unclear] and continue. Keep names, dates, and the original spelling.",
  "Skip website pages, browser text, and other sheets that are only underneath the document.",
  "Do not add a note about the transcription.",
  "Handwriting counts as text even when it is hard to read. If the photo shows no writing at all, say \"No text\" and describe the scene in one sentence.",
].join(" ");

const BAND_PROMPT = [
  "This is one strip of a photographed page.",
  "Transcribe every handwritten line in this strip, from top to bottom.",
  "Do not summarize. Do not skip a line. Do not use ellipses or [...].",
  "If one word cannot be read, write [unclear] and continue. Keep the original spelling.",
  "Ignore printed website pages, census forms, and other sheets that are only underneath the handwriting.",
  "If this strip has no handwriting, reply with exactly: empty",
  "Do not add a note.",
].join(" ");

async function askVision(
  preview: Buffer,
  asset: CatalogAsset,
  apiKey: string,
  larger: () => Promise<Buffer>,
): Promise<string> {
  const text = await readImageText(preview.toString("base64"), apiKey, "gpt-4o-mini", TRANSCRIBE_PROMPT);
  if (!text) throw new Error(`GPT returned no description for ${asset.filename}.`);
  if (!needsCloserRead(text)) return cleanTranscript(text);

  const tiles = await tileImage(await larger());
  const parts: string[] = [];
  for (const tile of tiles) {
    let piece = "";
    try {
      piece = await readImageText(tile.toString("base64"), apiKey, "gpt-4o", BAND_PROMPT);
    } catch {
      piece = "";
    }
    const cleaned = cleanTranscript(piece);
    if (!readablePassage(cleaned)) continue;
    parts.push(cleaned);
  }
  const joined = joinBands(parts);
  const first = cleanTranscript(text);
  if (readablePassage(joined) && joined.length > first.length) return joined;
  return first;
}

async function readImageText(base64: string, apiKey: string, model: string, prompt: string): Promise<string> {
  const response = await openai(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      max_tokens: 5000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } },
          ],
        },
      ],
    },
    apiKey,
  );
  const text = response.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function needsCloserRead(text: string): boolean {
  return omittedPassage(text) || isRefusal(text);
}

function readablePassage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(empty|no text|i'm sorry|i am sorry)\b/i.test(trimmed)) return false;
  if (isRefusal(trimmed)) return false;
  return true;
}

function omittedPassage(text: string): boolean {
  return /\[\.\.\.\]|\.{3,}/.test(text);
}

function joinBands(parts: string[]): string {
  const lines: string[] = [];
  for (const part of parts) {
    const next = part.split("\n");
    let cut = 0;
    const max = Math.min(4, lines.length, next.length);
    for (let count = max; count >= 1; count -= 1) {
      const tail = lines.slice(-count).map((line) => line.trim()).join("\n");
      const head = next.slice(0, count).map((line) => line.trim()).join("\n");
      if (tail && tail === head) {
        cut = count;
        break;
      }
    }
    lines.push(...next.slice(cut));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanTranscript(text: string): string {
  return text.replace(/\n+\(Note:[\s\S]*$/i, "").trim();
}

async function tileImage(jpeg: Buffer): Promise<Buffer[]> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 900 || height < 900) return [];
  const wide = width > height * 1.15;
  const tall = height > width * 1.15;
  const columns = tall && !wide ? 1 : 2;
  const rows = tall || !wide ? 2 : 1;
  const overlapX = Math.round((width / columns) * 0.06);
  const overlapY = Math.round((height / rows) * 0.04);
  const tileW = Math.ceil(width / columns);
  const tileH = Math.ceil(height / rows);
  const tiles: Buffer[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const left = Math.max(0, column * tileW - (column > 0 ? overlapX : 0));
      const top = Math.max(0, row * tileH - (row > 0 ? overlapY : 0));
      const right = Math.min(width, (column + 1) * tileW + (column < columns - 1 ? overlapX : 0));
      const bottom = Math.min(height, (row + 1) * tileH + (row < rows - 1 ? overlapY : 0));
      tiles.push(
        await sharp(jpeg)
          .extract({ left, top, width: right - left, height: bottom - top })
          .jpeg({ quality: 90 })
          .toBuffer(),
      );
    }
  }
  return tiles;
}

export async function refreshTranscript(filename: string): Promise<{ filename: string; characters: number }> {
  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  const captures = await loadCaptures(path.join("data", "catalog.json"));
  const item = captures
    .flatMap((capture) => capture.assets.map((asset) => ({ asset, capture: capture.basename })))
    .find((entry) => entry.asset.filename === filename);
  if (!item) throw new Error(`Could not find ${filename}.`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const description = await describeFile(sourceDir, item.asset, apiKey);
  if (isRefusal(description) || /^no text\b/i.test(description)) {
    throw new Error(`No transcription for ${filename}.`);
  }
  const memory = await readCheckpoint();
  const previous = memory[item.asset.sourcePath]?.description ?? "";
  if (previous.length > description.length && !/^no text\b/i.test(previous)) {
    return { filename, characters: previous.length };
  }
  memory[item.asset.sourcePath] = { description, upserted: false };
  await writeCheckpoint(memory);
  await publishTranscript(item.asset, item.capture, description);
  return { filename, characters: description.length };
}

function isRefusal(text: string): boolean {
  const opening = text.trim().slice(0, 180);
  if (text.trim().length > 700) return false;
  return /^(i'm sorry|i am sorry|unable to|i cannot|i can't)/i.test(opening);
}

async function embed(input: string[], apiKey: string): Promise<number[][]> {
  const response = await openai(
    "https://api.openai.com/v1/embeddings",
    { model: "text-embedding-3-small", input },
    apiKey,
  );
  const rows = (response.data ?? []) as Array<{ index: number; embedding: number[] }>;
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

async function upsert(
  credentials: { url: string; token: string },
  rows: Array<{ id: string; vector: number[]; metadata: Record<string, string | number | boolean> }>,
): Promise<void> {
  const response = await fetch(`${credentials.url}/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`Upstash upsert failed (${response.status}). ${(await response.text()).slice(0, 300)}`);
  }
}

async function openai(url: string, body: unknown, apiKey: string): Promise<OpenAIResponse> {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    last = await response.text();
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`OpenAI request failed. ${last.slice(0, 300)}`);
}

async function readCheckpoint(): Promise<Record<string, Memory>> {
  try {
    return JSON.parse(await readFile(CHECKPOINT, "utf8")) as Record<string, Memory>;
  } catch {
    return {};
  }
}

async function writeCheckpoint(memory: Record<string, Memory>): Promise<void> {
  await writeFile(CHECKPOINT, JSON.stringify(memory, null, 2));
}
