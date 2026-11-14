import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

const execFileAsync = promisify(execFile);

export type ImageCrop = { x: number; y: number; w: number; h: number };

export function previewEdge(size: "thumb" | "full"): 480 | 1600 {
  return size === "full" ? 1600 : 480;
}

export function previewPathname(sha256: string, edge: number): string {
  return `media/previews/${sha256}-${edge}.jpg`;
}

export async function readPrivateBlob(pathname: string, token: string): Promise<Buffer | null> {
  const { get } = await import("@vercel/blob");
  const result = await get(pathname, { access: "private", token });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function writePrivateBlob(pathname: string, body: Buffer, token: string): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(pathname, body, {
    access: "private",
    token,
    contentType: "image/jpeg",
    allowOverwrite: true,
    addRandomSuffix: false,
  });
}

export async function presentJpeg(jpeg: Buffer, rotation: number, crop: ImageCrop | null): Promise<Buffer> {
  if (!rotation && !crop) return jpeg;
  const meta = await sharp(jpeg, { failOn: "none" }).metadata();
  let image = sharp(jpeg, { failOn: "none" });
  if (rotation) image = image.rotate(rotation);
  if (crop) {
    const sized = await image.toBuffer();
    const size = await sharp(sized).metadata();
    const width = size.width ?? 0;
    const height = size.height ?? 0;
    if (!width || !height) return sized;
    const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
    const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
    const cropW = Math.max(1, Math.min(width - left, Math.round(crop.w * width)));
    const cropH = Math.max(1, Math.min(height - top, Math.round(crop.h * height)));
    image = sharp(sized).extract({ left, top, width: cropW, height: cropH });
  }
  if (meta.orientation) image = image.withMetadata({ orientation: meta.orientation });
  return image.jpeg({ quality: 82 }).toBuffer();
}

export async function storeImagePreviews(input: { absolute: string; sha256: string; extension: string; token: string }): Promise<void> {
  const edges = [480, 1600] as const;
  const fromSips = await Promise.all(edges.map((edge) => sipsPreview(input.absolute, edge)));
  const previews = fromSips.every((item): item is Buffer => item !== null)
    ? fromSips
    : await jpegPreviews(await readFile(input.absolute), input.extension, [...edges]);
  await Promise.all(previews.map((body, index) => writePrivateBlob(previewPathname(input.sha256, edges[index]), body, input.token)));
}

async function sipsPreview(absolute: string, edge: number): Promise<Buffer | null> {
  const destination = path.join(tmpdir(), `husfeld-preview-${randomBytes(8).toString("hex")}.jpg`);
  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", String(edge), absolute, "--out", destination]);
    return await readFile(destination);
  } catch {
    return null;
  } finally {
    await rm(destination, { force: true });
  }
}

async function jpegPreviews(bytes: Buffer, extension: string, edges: number[]): Promise<Buffer[]> {
  const normalized = extension === "heic" || extension === "heif" ? await heicToJpeg(bytes) : bytes;
  const oriented = await sharp(normalized, { failOn: "none" }).rotate().toBuffer();
  return Promise.all(
    edges.map((edge) => sharp(oriented).resize({ width: edge, height: edge, fit: "inside" }).jpeg({ quality: 82 }).toBuffer()),
  );
}

async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  const convert = (await import("heic-convert")).default;
  return Buffer.from(await convert({ buffer: bytes, format: "JPEG", quality: 0.9 }));
}
