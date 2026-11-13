import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const relative = url.searchParams.get("path") ?? "";
  const size = url.searchParams.get("size") === "full" ? "full" : "thumb";
  const absolute = resolveSource(relative);
  if (!absolute) return new Response("Photo not found.", { status: 404 });

  try {
    await access(absolute);
  } catch {
    return new Response("Photo not found.", { status: 404 });
  }

  const edge = size === "full" ? "1600" : "480";
  const cache = path.join("data", "thumbs", `${createHash("sha256").update(`${edge}:${relative}`).digest("hex")}.jpg`);
  try {
    await access(cache);
  } catch {
    await mkdir(path.dirname(cache), { recursive: true });
    try {
      await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", edge, absolute, "--out", cache]);
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

function resolveSource(relative: string): string | null {
  if (!relative || relative.includes("\0")) return null;
  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  const absolute = path.resolve(sourceDir, relative);
  if (absolute !== sourceDir && !absolute.startsWith(`${sourceDir}${path.sep}`)) return null;
  return absolute;
}
