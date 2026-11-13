import { readFile } from "node:fs/promises";

import { getPrisma } from "@/lib/prisma";

export type VectorProgress = {
  described: number;
  stored: number;
  total: number;
};

export async function readVectorProgress(): Promise<VectorProgress> {
  const [checkpoint, total] = await Promise.all([readCheckpoint(), countMedia()]);
  return { ...checkpoint, total };
}

async function readCheckpoint(): Promise<{ described: number; stored: number }> {
  try {
    const memory = JSON.parse(await readFile("data/understandings.json", "utf8")) as Record<
      string,
      { description?: string; upserted?: boolean }
    >;
    const rows = Object.values(memory);
    return {
      described: rows.filter((row) => row.description).length,
      stored: rows.filter((row) => row.upserted).length,
    };
  } catch {
    return { described: 0, stored: 0 };
  }
}

async function countMedia(): Promise<number> {
  const prisma = getPrisma();
  if (prisma) {
    try {
      return await prisma.asset.count({ where: { kind: { in: ["IMAGE", "VIDEO"] } } });
    } catch {
      // The pooled database is sometimes unreachable. The total still lives in the local catalog.
    }
  }
  return countLocalMedia();
}

async function countLocalMedia(): Promise<number> {
  try {
    const catalog = JSON.parse(await readFile("data/catalog.json", "utf8")) as {
      stats?: { images?: number; videos?: number };
    };
    return (catalog.stats?.images ?? 0) + (catalog.stats?.videos ?? 0);
  } catch {
    return 0;
  }
}
