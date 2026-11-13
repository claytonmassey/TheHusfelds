import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SpotlightMetadata = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
};

const EMPTY: SpotlightMetadata = {
  width: null,
  height: null,
  durationMs: null,
  capturedAt: null,
};

export async function readSpotlightMetadata(absolutePaths: string[]): Promise<SpotlightMetadata[]> {
  if (process.platform !== "darwin" || absolutePaths.length === 0) {
    return absolutePaths.map(() => ({ ...EMPTY }));
  }

  const results: SpotlightMetadata[] = [];
  for (let index = 0; index < absolutePaths.length; index += 25) {
    const chunk = absolutePaths.slice(index, index + 25);
    results.push(...(await readChunk(chunk)));
  }
  return results;
}

async function readChunk(absolutePaths: string[]): Promise<SpotlightMetadata[]> {
  try {
    const { stdout } = await execFileAsync(
      "mdls",
      [
        "-plist",
        "-",
        "-name",
        "kMDItemPixelWidth",
        "-name",
        "kMDItemPixelHeight",
        "-name",
        "kMDItemDurationSeconds",
        "-name",
        "kMDItemContentCreationDate",
        ...absolutePaths,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = parseMdlsPlist(stdout);
    if (parsed.length === absolutePaths.length) return parsed;
  } catch {
    // Fall through and try each file on its own.
  }

  const singles: SpotlightMetadata[] = [];
  for (const filePath of absolutePaths) {
    try {
      const { stdout } = await execFileAsync(
        "mdls",
        [
          "-plist",
          "-",
          "-name",
          "kMDItemPixelWidth",
          "-name",
          "kMDItemPixelHeight",
          "-name",
          "kMDItemDurationSeconds",
          "-name",
          "kMDItemContentCreationDate",
          filePath,
        ],
        { maxBuffer: 1024 * 1024 },
      );
      singles.push(parseMdlsPlist(stdout)[0] ?? { ...EMPTY });
    } catch {
      singles.push({ ...EMPTY });
    }
  }
  return singles;
}

export function parseMdlsPlist(xml: string): SpotlightMetadata[] {
  const dicts = xml.match(/<dict>[\s\S]*?<\/dict>/g) ?? [];
  return dicts.map((dict) => {
    const width = numberTag(dict, "kMDItemPixelWidth");
    const height = numberTag(dict, "kMDItemPixelHeight");
    const duration = numberTag(dict, "kMDItemDurationSeconds");
    const captured = textTag(dict, "kMDItemContentCreationDate");
    const capturedAt = captured ? new Date(captured).toISOString() : null;

    return {
      width,
      height,
      durationMs: duration == null ? null : Math.round(duration * 1000),
      capturedAt: capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? capturedAt : null,
    };
  });
}

function numberTag(dict: string, key: string): number | null {
  const match = dict.match(new RegExp(`<key>${key}</key>\\s*<(integer|real)>([^<]+)</\\1>`));
  if (!match) return null;
  const value = Number(match[2]);
  return Number.isFinite(value) ? value : null;
}

function textTag(dict: string, key: string): string | null {
  const match = dict.match(new RegExp(`<key>${key}</key>\\s*<(date|string)>([^<]+)</\\1>`));
  return match?.[2] ?? null;
}
