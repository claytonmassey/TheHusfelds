import { listKnownNames } from "@/lib/known-names";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const names = await listKnownNames();
  return Response.json({ names });
}
