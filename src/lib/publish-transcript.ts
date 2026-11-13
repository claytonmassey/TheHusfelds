import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { vectorRecord } from "@/ingest/vectors";
import type { CatalogAsset } from "@/lib/catalog";
import { upstashVectorCredentials } from "@/lib/prisma";

const CHECKPOINT = path.join("data", "understandings.json");

type Memory = {
  description: string;
  upserted: boolean;
};

type EmbeddingResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
};

export async function publishTranscript(asset: CatalogAsset, capture: string, description: string): Promise<void> {
  const credentials = upstashVectorCredentials();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!credentials) throw new Error("Upstash Vector is not configured.");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const [vector] = await embed([`${vectorRecord(asset, capture).data}. ${description}`], apiKey);
  const record = vectorRecord(asset, capture);
  await upsert(credentials, [
    {
      id: record.id,
      vector,
      metadata: { ...record.metadata, description: description.slice(0, 8000) },
    },
  ]);
  const memory = await readCheckpoint();
  memory[asset.sourcePath] = { description, upserted: true };
  await writeCheckpoint(memory);
}

async function embed(input: string[], apiKey: string): Promise<number[][]> {
  const response = await openai("https://api.openai.com/v1/embeddings", { model: "text-embedding-3-small", input }, apiKey);
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

async function openai(url: string, body: unknown, apiKey: string): Promise<EmbeddingResponse> {
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
