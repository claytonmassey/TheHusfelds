import { readDraft } from "@/lib/family-draft";
import { mergeKnownNames, type KnownName } from "@/lib/known-name";
import { readPeople } from "@/lib/photo-record";

export async function listKnownNames(): Promise<KnownName[]> {
  const [people, draft] = await Promise.all([readPeople(), readDraft()]);
  const fromDraft: KnownName[] = draft.people.map((person) => ({
    name: person.name,
    role: person.role,
    parentNames: person.parentNames,
    siblingNames: person.siblingNames,
    wifeName: person.wifeName,
    born: person.born,
    where: "draft",
    draftId: person.id,
  }));
  return mergeKnownNames(fromDraft, people);
}
