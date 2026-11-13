import { askLibrary } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a question." }, { status: 400 });
  }

  try {
    return Response.json(await askLibrary(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The question failed.";
    const status = message === "Send a question." ? 400 : message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
