export const ITEM_TYPES = [
  { id: "photograph", label: "Photograph" },
  { id: "letter", label: "Letter" },
  { id: "postcard", label: "Postcard" },
  { id: "record", label: "Record" },
] as const;

export type ItemTypeId = (typeof ITEM_TYPES)[number]["id"];

export type Person = {
  id: string;
  name: string;
  role: "" | "daughter" | "son";
  parentNames: string[];
};

export type PhotoPin = {
  id: string;
  x: number;
  y: number;
  kind: "person" | "thing";
  label: string;
  personId?: string;
};

export type PhotoRecord = {
  sourcePath: string;
  types: ItemTypeId[];
  categories: string[];
  pins: PhotoPin[];
  note: string;
  updatedAt: string;
};

export function emptyPhotoRecord(sourcePath: string): PhotoRecord {
  return { sourcePath, types: [], categories: [], pins: [], note: "", updatedAt: "" };
}

export function sameName(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function splitParents(value: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(/,|&|\band\b/i)) {
    const name = part.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length === 4) break;
  }
  return names;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function typeLabel(id: string): string {
  return ITEM_TYPES.find((item) => item.id === id)?.label ?? id;
}

export function relationLine(person: Person): string {
  if (!person.role || person.parentNames.length === 0) return "";
  return `${person.name} is the ${person.role} of ${joinNames(person.parentNames)}.`;
}

export function describePhotoRecord(record: PhotoRecord, people: Person[]): string {
  const lines: string[] = [];
  if (record.types.length > 0) lines.push(`Types: ${record.types.map(typeLabel).join(", ")}`);
  if (record.categories.length > 0) lines.push(`Categories: ${record.categories.join(", ")}`);
  for (const pin of record.pins) {
    if (pin.kind === "thing") {
      lines.push(`Thing in this photo: ${pin.label}.`);
      continue;
    }
    const person = people.find((item) => item.id === pin.personId);
    const relation = person ? relationLine(person) : "";
    lines.push(relation ? `Person in this photo: ${relation}` : `Person in this photo: ${pin.label}.`);
  }
  if (record.note.trim()) lines.push(record.note.trim());
  return lines.join("\n");
}

export function familyMemory(people: Person[]): string {
  const lines = people
    .filter((person) => person.role && person.parentNames.length > 0)
    .slice(0, 80)
    .map((person) => `- ${relationLine(person)}`);
  if (lines.length === 0) return "";
  return `Family tree recorded from tagged photos. A line here replaces only that parent link.\n${lines.join("\n")}`;
}
