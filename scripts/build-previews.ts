import { access } from "node:fs/promises";
import path from "node:path";

import { head } from "@vercel/blob";

import { previewPathname, storeImagePreviews } from "../src/lib/image-preview";
import { getPrisma } from "../src/lib/prisma";

async function main() {
  const envToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!envToken) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  const token: string = envToken;
  const prisma = getPrisma();
  if (!prisma) throw new Error("Database is not configured.");

  const assets = await prisma.asset.findMany({
    where: { kind: "IMAGE" },
    select: { sourcePath: true, sha256: true, extension: true },
    orderBy: { filename: "asc" },
  });
  const sourceDir = path.resolve(process.env.SOURCE_DIR ?? "Source");
  let created = 0;
  let skipped = 0;
  let missing = 0;
  const queue = [...assets];

  async function worker() {
    for (;;) {
      const asset = queue.shift();
      if (!asset) return;
      const absolute = path.resolve(sourceDir, asset.sourcePath);
      if (absolute === sourceDir || !absolute.startsWith(`${sourceDir}${path.sep}`)) {
        missing += 1;
        continue;
      }
      try {
        await access(absolute);
      } catch {
        missing += 1;
        continue;
      }

      const names = [previewPathname(asset.sha256, 480), previewPathname(asset.sha256, 1600)];
      const ready = await Promise.all(
        names.map(async (name) => {
          try {
            await head(name, { token });
            return true;
          } catch {
            return false;
          }
        }),
      );
      if (ready.every(Boolean)) skipped += 1;
      else {
        await storeImagePreviews({ absolute, sha256: asset.sha256, extension: asset.extension, token });
        created += 1;
      }

      const finished = created + skipped + missing;
      if (finished % 25 === 0 || finished === assets.length) {
        console.log(`${finished}/${assets.length} checked, ${created} created, ${skipped} already stored, ${missing} missing`);
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  console.log(`Done. ${created} created, ${skipped} already stored, ${missing} missing.`);
  await prisma.$disconnect();
}

main();
