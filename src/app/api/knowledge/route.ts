import { currentAccountId } from "@/lib/accounts";
import { loadCatalog } from "@/lib/load-catalog";
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
    await assertImageOwner(sourcePath);
    await removeKnowledgeDocument(sourcePath);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That document could not be removed.";
    const status = /Log in to remove/.test(message) ? 401 : /only remove photos/.test(message) ? 403 : /Choose a document|not in the library/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}

async function assertImageOwner(sourcePath: string): Promise<void> {
  const loaded = await loadCatalog();
  const asset = loaded.catalog?.captures.flatMap((capture) => capture.assets).find((item) => item.sourcePath === sourcePath);
  if (!asset || asset.kind !== "IMAGE") return;
  const accountId = await currentAccountId();
  if (!accountId) throw new Error("Log in to remove a photo.");
  if (!asset.uploadedBy || asset.uploadedBy !== accountId) throw new Error("You can only remove photos you added.");
}
