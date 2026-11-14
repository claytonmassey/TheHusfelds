import { normalizeName } from "@/lib/photo-types";

export type KnownName = {
  name: string;
  role: "" | "daughter" | "son";
  parentNames: string[];
  siblingNames: string[];
  wifeName: string;
  born: string;
  where: "family" | "draft";
  draftId?: string;
  liveId?: string;
};

export function mergeKnownNames(
  base: KnownName[],
  family: {
    name: string;
    role: "" | "daughter" | "son";
    parentNames: string[];
    siblingNames?: string[];
    wifeName?: string;
    born?: string;
    id?: string;
    liveId?: string;
    draftId?: string;
  }[],
): KnownName[] {
  const map = new Map<string, KnownName>();
  for (const item of base) {
    const key = normalizeName(item.name);
    if (!key) continue;
    map.set(key, item);
  }
  for (const person of family) {
    const key = normalizeName(person.name);
    if (!key) continue;
    const existing = map.get(key);
    map.set(key, {
      name: person.name,
      role: person.role,
      parentNames: person.parentNames,
      siblingNames: person.siblingNames ?? existing?.siblingNames ?? [],
      wifeName: person.wifeName ?? existing?.wifeName ?? "",
      born: person.born || existing?.born || "",
      where: "family",
      draftId: existing?.draftId ?? person.draftId,
      liveId: person.liveId ?? person.id ?? existing?.liveId,
    });
  }
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}
