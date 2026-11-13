import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ScannedFile } from "./files";

export async function scanSource(sourceDir: string): Promise<ScannedFile[]> {
  const root = path.resolve(sourceDir);
  const found: ScannedFile[] = [];
  await walk(root, root, found);
  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found;
}

async function walk(root: string, directory: string, found: ScannedFile[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolutePath, found);
      continue;
    }
    if (!entry.isFile()) continue;

    const fileStat = await stat(absolutePath);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    const extension = path.posix.extname(entry.name).slice(1).toLowerCase();
    found.push({
      absolutePath,
      relativePath,
      filename: entry.name,
      extension,
      basename: path.posix.parse(relativePath).name,
      byteSize: fileStat.size,
      sourceModified: fileStat.mtime.toISOString(),
    });
  }
}
