import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { presentJpeg, previewEdge, previewPathname, readPrivateBlob, storeImagePreviews, type ImageCrop } from "@/lib/image-preview";
import { getPrisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const relative = url.searchParams.get("path") ?? "";
  const size = url.searchParams.get("size") === "full" ? "full" : "thumb";
  const turn = Number(url.searchParams.get("turn"));
  const rotation = turn === 90 || turn === 180 || turn === 270 ? turn : 0;
  const crop = cropOf(url);
  const absolute = resolveSource(relative);
  if (absolute && (await readable(absolute))) return serveLocal(absolute, relative, size, rotation, crop);

  try {
    const stored = await serveStored(relative, size, rotation, crop);
    if (stored) return stored;
  } catch {
    return new Response("Photo could not be prepared.", { status: 422 });
  }
  return new Response("Photo not found.", { status: 404 });
}

async function serveLocal(absolute: string, relative: string, size: "thumb" | "full", rotation: number, crop: ImageCrop | null) {
  const edge = size === "full" ? "1600" : "480";
  const baseKey = [edge, relative, rotation || ""].filter(Boolean).join(":");
  const base = path.join("data", "thumbs", `${createHash("sha256").update(baseKey).digest("hex")}.jpg`);
  const cache = crop
    ? path.join("data", "thumbs", `${createHash("sha256").update(`${baseKey}:${crop.x},${crop.y},${crop.w},${crop.h}`).digest("hex")}.jpg`)
    : base;
  try {
    await access(cache);
  } catch {
    await mkdir(path.dirname(cache), { recursive: true });
    try {
      try {
        await access(base);
      } catch {
        const args = ["-s", "format", "jpeg", "-Z", edge];
        if (rotation) args.push("-r", String(rotation));
        args.push(absolute, "--out", base);
        await execFileAsync("sips", args);
      }
      if (crop) await cropImage(base, cache, crop);
    } catch {
      return new Response("Photo could not be prepared.", { status: 422 });
    }
  }

  const bytes = await readFile(cache);
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

async function serveStored(relative: string, size: "thumb" | "full", rotation: number, crop: ImageCrop | null) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const prisma = getPrisma();
  if (!token || !prisma || !relative) return null;
  const asset = await prisma.asset.findUnique({
    where: { sourcePath: relative },
    select: { sha256: true, blobPathname: true, extension: true, kind: true },
  });
  if (!asset || asset.kind !== "IMAGE") return null;

  const edge = previewEdge(size);
  const pathname = previewPathname(asset.sha256, edge);
  let jpeg = await readPrivateBlob(pathname, token);
  if (!jpeg && asset.blobPathname) {
    const original = await readPrivateBlob(asset.blobPathname, token);
    if (!original) return null;
    const directory = path.join(process.env.VERCEL ? "/tmp" : path.join("data", "thumbs"), "blob-originals");
    await mkdir(directory, { recursive: true });
    const absolute = path.join(directory, `${asset.sha256}.${asset.extension}`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(absolute, original);
    await storeImagePreviews({ absolute, sha256: asset.sha256, extension: asset.extension, token });
    jpeg = await readPrivateBlob(pathname, token);
  }
  if (!jpeg) return null;
  const body = await presentJpeg(jpeg, rotation, crop);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

async function readable(absolute: string): Promise<boolean> {
  try {
    await access(absolute);
    return true;
  } catch {
    return false;
  }
}

function resolveSource(relative: string): string | null {
  if (!relative || relative.includes("\0")) return null;
  const sourceDir = path.resolve(/*turbopackIgnore: true*/ process.env.SOURCE_DIR ?? "Source");
  const absolute = path.resolve(sourceDir, relative);
  if (absolute !== sourceDir && !absolute.startsWith(`${sourceDir}${path.sep}`)) return null;
  return absolute;
}

function cropOf(url: URL): { x: number; y: number; w: number; h: number } | null {
  const values = ["ax", "ay", "aw", "ah"].map((key) => Number(url.searchParams.get(key)));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, w, h] = values;
  if (x < 0 || y < 0 || w < 0.04 || h < 0.04 || x + w > 1.05 || y + h > 1.05) return null;
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    w: Math.round(Math.min(w, 1 - x) * 10000) / 10000,
    h: Math.round(Math.min(h, 1 - y) * 10000) / 10000,
  };
}

async function cropImage(source: string, destination: string, crop: { x: number; y: number; w: number; h: number }) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", source]);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
  if (!width || !height) throw new Error("Photo could not be prepared.");
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
  const cropW = Math.max(1, Math.min(width - left, Math.round(crop.w * width)));
  const cropH = Math.max(1, Math.min(height - top, Math.round(crop.h * height)));
  await execFileAsync("sips", ["--cropOffset", String(top), String(left), "--cropToHeightWidth", String(cropH), String(cropW), source, "--out", destination]);
}
