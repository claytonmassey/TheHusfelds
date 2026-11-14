import { currentAccount } from "@/lib/accounts";
import { addPageEdit, assertPagePath, readPageEdits } from "@/lib/page-edits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const sourcePath = new URL(request.url).searchParams.get("path") ?? "";
  try {
    assertPagePath(sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Choose a photo.";
    return Response.json({ error: message }, { status: 400 });
  }
  const account = await currentAccount();
  return Response.json({ edits: await readPageEdits(sourcePath), canEdit: Boolean(account) });
}

export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Log in to edit this page." }, { status: 401 });

  let body: { sourcePath?: unknown; text?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Write the detail." }, { status: 400 });
  }

  try {
    const edits = await addPageEdit(typeof body.sourcePath === "string" ? body.sourcePath : "", typeof body.text === "string" ? body.text : "", account.name);
    return Response.json({ edits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That detail could not be saved.";
    const status = message === "Write the detail." || message === "Choose a photo." || message === "That detail is already saved." ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
