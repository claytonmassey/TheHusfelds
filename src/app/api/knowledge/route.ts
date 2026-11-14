import { removeKnowledgeDocument } from "@/lib/remove-document";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request) {
  let body: { sourcePath?: unknown };
  try {
    body = (await request.json()) as { sourcePath?: unknown };
  } catch {
    return Response.json({ error: "Choose a document." }, { status: 400 });
  }
  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
  try {
    await removeKnowledgeDocument(sourcePath);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That document could not be removed.";
    const status = /Choose a document|not in the library/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
