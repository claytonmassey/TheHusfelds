import { translatePage } from "@/lib/translate-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Nothing to translate." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  try {
    const translation = await translatePage(text);
    return Response.json(translation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The translation did not come back.";
    const status = message === "Nothing to translate." ? 400 : message.includes("not set") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
