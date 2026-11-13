import { NextResponse } from "next/server";

import { loadCatalog } from "@/lib/load-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const loaded = await loadCatalog();
  return NextResponse.json(loaded);
}
