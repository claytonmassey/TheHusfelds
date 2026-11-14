import { applyDraft, combineDraftNames, readDraft, startDraftScan, updateDraftLinks } from "@/lib/family-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return Response.json(await readDraft());
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const action = (body as { action?: unknown }).action;
  try {
    if (action === "apply") return Response.json(await applyDraft());
    if (action === "link") return Response.json(await updateDraftLinks(body));
    if (action === "combine") return Response.json(await combineDraftNames(body));
    startDraftScan();
    return Response.json(await readDraft());
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be done.";
    return Response.json({ error: message }, { status: 400 });
  }
}
