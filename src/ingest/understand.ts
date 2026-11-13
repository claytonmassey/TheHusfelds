import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
    const jpeg = await previewJpeg(sourceDir, asset, directory);
    const bytes = await readFile(jpeg);
    return await askVision(bytes.toString("base64"), asset, apiKey);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function previewJpeg(sourceDir: string, asset: CatalogAsset, directory: string): Promise<string> {
  const source = path.join(sourceDir, ...asset.sourcePath.split("/"));
  const jpeg = path.join(directory, "preview.jpg");
  if (asset.kind === "IMAGE" || asset.extension === "pdf") {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", "2048", source, "--out", jpeg]);
    return jpeg;
  }

  await execFileAsync("qlmanage", ["-t", "-s", "2048", "-o", directory, source]);
  const png = path.join(directory, `${path.basename(source)}.png`);
  await execFileAsync("sips", ["-s", "format", "jpeg", png, "--out", jpeg]);
  return jpeg;
}

async function askVision(base64: string, asset: CatalogAsset, apiKey: string): Promise<string> {
  const prompt =
    "Transcribe every piece of visible text in this image. Copy names, dates, places, and numbers as written, and keep the line breaks. Do not summarize. If a word is unclear, write [unclear]. If the image has no text, say \"No text\" and describe the scene in one sentence.";

  const response = await openai(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      max_tokens: 2000,
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
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error(`GPT returned no description for ${asset.filename}.`);
  }
  return text.trim();
}

function isRefusal(text: string): boolean {
  return /unable to|cannot (provide|assist|transcribe)|can't assist|i'm sorry/i.test(text);
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
