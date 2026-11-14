import { assertPagePath } from "@/lib/page-edits";
import { searchTranscripts } from "@/lib/page-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourcePath = url.searchParams.get("path") ?? "";
  const term = url.searchParams.get("q") ?? "";
  try {
    if (sourcePath) assertPagePath(sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Choose a photo.";
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ hits: await searchTranscripts(term, sourcePath) });
}
