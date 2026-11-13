import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Correction = {
  id: string;
  statement: string;
  replaced: string;
  createdAt: string;
};

const FILE = path.join("data", "corrections.json");

export async function readCorrections(): Promise<Correction[]> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      const item = row as Partial<Correction>;
      if (typeof item.statement !== "string" || !item.statement.trim()) return [];
      return [
        {
          id: typeof item.id === "string" ? item.id : randomUUID(),
          statement: item.statement.trim(),
          replaced: typeof item.replaced === "string" ? item.replaced.trim() : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

export async function addCorrection(input: { statement?: unknown; replaced?: unknown }): Promise<Correction> {
  const statement = typeof input.statement === "string" ? input.statement.trim().slice(0, 500) : "";
  if (!statement) throw new Error("Write the correct fact.");
  const replaced = typeof input.replaced === "string" ? input.replaced.trim().slice(0, 1000) : "";
  const corrections = await readCorrections();
  const correction: Correction = {
    id: randomUUID(),
    statement,
    replaced,
    createdAt: new Date().toISOString(),
  };
  corrections.push(correction);
  await writeFile(FILE, JSON.stringify(corrections, null, 2));
  return correction;
}

export function correctionMemory(corrections: Correction[]): string {
  if (corrections.length === 0) return "";
  const lines = corrections.slice(-40).map((correction) => `- ${correction.statement}`);
  return `Corrected family memory. These facts replace only the claims they contradict. Keep every other detail the pages support.\n${lines.join("\n")}`;
}
