import { saveImageNote } from "@/lib/image-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { sourcePath?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { sourcePath?: unknown; note?: unknown };
  } catch {
    return Response.json({ error: "Write what you know about this photo." }, { status: 400 });
  }

  try {
    const note = await saveImageNote(
      typeof body.sourcePath === "string" ? body.sourcePath : "",
      typeof body.note === "string" ? body.note : "",
    );
    return Response.json({ note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The note could not be saved.";
    const status = /Choose a photo|Write what you know|not in the library|not set/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
