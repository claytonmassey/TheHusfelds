import { readPageTranscript } from "@/lib/image-context";
import { addPhotoTag, assignPhotoCategories, movePhotoTag, readPhotoLibrary, removePhotoTag, rotatePhoto, savePhotoNote, updatePhotoTag } from "@/lib/photo-record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const sourcePath = new URL(request.url).searchParams.get("path") ?? "";
  if (!sourcePath || sourcePath.includes("..")) {
    return Response.json({ error: "Choose a photo." }, { status: 400 });
  }
  const library = await readPhotoLibrary(sourcePath);
  const text = await readPageTranscript(sourcePath);
  return Response.json({ ...library, text });
}

export async function POST(request: Request) {
  let body: {
    action?: unknown;
    sourcePath?: unknown;
    types?: unknown;
    categories?: unknown;
    pinId?: unknown;
    note?: unknown;
    direction?: unknown;
    x?: unknown;
    y?: unknown;
    kind?: unknown;
    name?: unknown;
    role?: unknown;
    parents?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Choose a photo." }, { status: 400 });
  }

  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
  try {
    if (body.action === "categories") return Response.json(await assignPhotoCategories(sourcePath, body.types, body.categories));
    if (body.action === "tag") {
      return Response.json(
        await addPhotoTag(sourcePath, { x: body.x, y: body.y, kind: body.kind, name: body.name, role: body.role, parents: body.parents }),
      );
    }
    if (body.action === "edit") {
      return Response.json(
        await updatePhotoTag(sourcePath, { pinId: body.pinId, kind: body.kind, name: body.name, role: body.role, parents: body.parents }),
      );
    }
    if (body.action === "move") {
      return Response.json(await movePhotoTag(sourcePath, typeof body.pinId === "string" ? body.pinId : "", body.x, body.y));
    }
    if (body.action === "untag") return Response.json(await removePhotoTag(sourcePath, typeof body.pinId === "string" ? body.pinId : ""));
    if (body.action === "note") return Response.json(await savePhotoNote(sourcePath, body.note));
    if (body.action === "rotate") return Response.json(await rotatePhoto(sourcePath, body.direction));
    return Response.json({ error: "Choose a photo." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be saved.";
    const status = /Choose a photo|Choose a tag|Choose left or right|Type a name|Click a spot|person or a thing|daughter or son|own parent|40 tags/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
