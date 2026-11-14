import { describeHistory, describePerson, findDocuments } from "@/lib/describe-person";
import { createPersonFamily, readPeople, readPersonDocuments, setPersonAvatar, updatePersonFamily } from "@/lib/photo-record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const part = url.searchParams.get("part") ?? "general";
  const person = (await readPeople()).find((item) => item.id === id);
  if (!person) return Response.json({ error: "Choose a person." }, { status: 400 });

  try {
    if (part === "history") {
      const result = await describeHistory(person.name);
      return Response.json({ summary: result.answer, sources: result.sources, mentions: result.filenames });
    }
    if (part === "documents") {
      const documents = await readPersonDocuments(person.id);
      try {
        const result = await findDocuments(person.name);
        return Response.json({ summary: result.answer, sources: result.sources, documents, mentions: result.filenames });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The library could not be read just now.";
        return Response.json({ summary: "", sources: [], documents, error: message });
      }
    }
    const result = await describePerson(person.name);
    return Response.json({ summary: result.answer, sources: result.sources, mentions: result.filenames });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The library could not be read just now.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { action?: unknown; id?: unknown; avatar?: unknown; name?: unknown; role?: unknown; parents?: unknown; siblings?: unknown; wife?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Choose a person." }, { status: 400 });
  }

  try {
    const id = typeof body.id === "string" ? body.id : "";
    if (body.action === "avatar") return Response.json(await setPersonAvatar(id, body.avatar));
    return Response.json(id ? await updatePersonFamily(id, body) : await createPersonFamily(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be saved.";
    const status = /Choose a person|Choose a photo|Drag the crop|Type a name|already in the family|daughter or son|own parent|own sibling|own wife|not a parent|not a sibling/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
