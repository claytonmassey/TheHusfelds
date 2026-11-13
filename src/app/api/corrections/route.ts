import { addCorrection, readCorrections } from "@/lib/corrections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ corrections: await readCorrections() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Write the correct fact." }, { status: 400 });
  }

  try {
    const correction = await addCorrection(body as { statement?: unknown; replaced?: unknown });
    return Response.json({ correction });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The correction could not be saved.";
    const status = message === "Write the correct fact." ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
