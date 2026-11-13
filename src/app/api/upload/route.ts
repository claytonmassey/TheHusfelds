import { ingestUploadedDocument } from "@/ingest/upload-document";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Choose a document." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a document." }, { status: 400 });
  }

  try {
    const uploaded = await ingestUploadedDocument(file);
    return Response.json({
      ...uploaded,
      transcript: uploaded.transcript.slice(0, 500),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The upload failed.";
    const status = /not set|Choose|Upload a|empty|smaller/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
