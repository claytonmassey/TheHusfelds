import { readFile } from "node:fs/promises";
import path from "node:path";

import { upstashVectorCredentials } from "@/lib/prisma";

const FILE = path.join("data", "understandings.json");
const FILLED_TTL_MS = 5 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 1000;

type Memory = Record<string, { description?: string }>;

let remoteCache: { at: number; map: Record<string, string> } | null = null;

export async function readTranscripts(): Promise<Record<string, string>> {
  const local = await readLocalTranscripts();
  if (Object.keys(local).length > 0) return local;
  return readRemoteTranscripts();
}

export async function readTranscript(sourcePath: string): Promise<string> {
  const transcripts = await readTranscripts();
  return transcripts[sourcePath] ?? "";
}

async function readLocalTranscripts(): Promise<Record<string, string>> {
  try {
    const memory = JSON.parse(await readFile(FILE, "utf8")) as Memory;
    return Object.fromEntries(Object.entries(memory).map(([key, value]) => [key, value.description ?? ""]));
  } catch {
    return {};
  }
}

async function readRemoteTranscripts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (remoteCache) {
    const ttl = Object.keys(remoteCache.map).length > 0 ? FILLED_TTL_MS : EMPTY_TTL_MS;
    if (now - remoteCache.at < ttl) return remoteCache.map;
  }
  const map = await fetchRemoteTranscripts();
  remoteCache = { at: now, map };
  return map;
}

async function fetchRemoteTranscripts(): Promise<Record<string, string>> {
  const credentials = upstashVectorCredentials();
  if (!credentials) return {};
  const map: Record<string, string> = {};
  let cursor = "0";
  const seen = new Set<string>();
  for (let page = 0; page < 30 && !seen.has(cursor); page += 1) {
    seen.add(cursor);
    let response: Response;
    try {
      response = await fetch(`${credentials.url}/range`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cursor, limit: 100, includeMetadata: true, includeVectors: false }),
      });
    } catch {
      return map;
    }
    if (!response.ok) return map;
    const payload = (await response.json()) as { result?: { nextCursor?: string; vectors?: unknown[] } };
    const vectors = payload.result?.vectors ?? [];
    for (const row of vectors) {
      const vector = row as { id?: string; metadata?: Record<string, unknown> };
      const text = metaText(vector.metadata, "description");
      const sourcePath = metaText(vector.metadata, "sourcePath") || vector.id || "";
      if (!text || !sourcePath || sourcePath.includes("..")) continue;
      const current = map[sourcePath];
      if (!current || text.length > current.length) map[sourcePath] = text;
    }
    const next = payload.result?.nextCursor;
    if (!next || vectors.length === 0) break;
    cursor = String(next);
  }
  return map;
}

function metaText(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}
