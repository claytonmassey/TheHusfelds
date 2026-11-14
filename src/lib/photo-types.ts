export const ITEM_TYPES = [
  { id: "photograph", label: "Photograph" },
  { id: "letter", label: "Letter" },
  { id: "postcard", label: "Postcard" },
  { id: "record", label: "Record" },
] as const;

export type ItemTypeId = (typeof ITEM_TYPES)[number]["id"];

export type PersonAvatar = {
  sourcePath: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Person = {
  id: string;
  name: string;
  role: "" | "daughter" | "son";
  parentNames: string[];
  siblingNames: string[];
  wifeName: string;
  born: string;
  died: string;
  birthplace: string;
  home: string;
  school: string;
  work: string;
  avatar?: PersonAvatar;
};

export type PhotoPin = {
  id: string;
  x: number;
  y: number;
  kind: "person" | "thing";
  label: string;
  personId?: string;
};

export type PhotoRotation = 0 | 90 | 180 | 270;

export type PhotoRecord = {
  sourcePath: string;
  types: ItemTypeId[];
  categories: string[];
  pins: PhotoPin[];
  rotation: PhotoRotation;
  note: string;
  updatedAt: string;
};

export function emptyPhotoRecord(sourcePath: string): PhotoRecord {
  return { sourcePath, types: [], categories: [], pins: [], rotation: 0, note: "", updatedAt: "" };
}

export function normalizeRotation(value: number): PhotoRotation {
  const turn = ((Math.round(value) % 360) + 360) % 360;
  if (turn === 90 || turn === 180 || turn === 270) return turn;
  return 0;
}

export function turnRotation(current: number, direction: "left" | "right"): PhotoRotation {
  return normalizeRotation(current + (direction === "right" ? 90 : -90));
}

export function turnPoint(x: number, y: number, direction: "left" | "right"): { x: number; y: number } {
  return direction === "right" ? { x: 1 - y, y: x } : { x: y, y: 1 - x };
}

export function sameName(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function familyNames(name: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  name.split(/\s+-\s+/).forEach((segment, index) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || (index === 0 && words.length < 2)) return;
    const surname = words[words.length - 1];
    const key = normalizeName(surname);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(surname);
  });
  return found;
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

export function formatLifeDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return value.trim();
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function lifeDates(person: Pick<Person, "born" | "died">): string {
  const born = formatLifeDate(person.born);
  const died = formatLifeDate(person.died);
  if (born && died) return `${born} – ${died}`;
  if (born) return `Born ${born}`;
  if (died) return `Died ${died}`;
  return "";
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
    .flatMap((person) => {
      const facts: string[] = [];
      if (person.role && person.parentNames.length > 0) facts.push(`- ${relationLine(person)}`);
      if (person.born.trim() && person.died.trim()) facts.push(`- ${person.name} was born ${formatLifeDate(person.born)} and died ${formatLifeDate(person.died)}.`);
      else if (person.born.trim()) facts.push(`- ${person.name} was born ${formatLifeDate(person.born)}.`);
      else if (person.died.trim()) facts.push(`- ${person.name} died ${formatLifeDate(person.died)}.`);
      if (person.birthplace.trim()) facts.push(`- ${person.name} was born in ${person.birthplace}.`);
      if (person.home.trim()) facts.push(`- ${person.name} lived in ${person.home}.`);
      if (person.school.trim()) facts.push(`- ${person.name} went to school at ${person.school}.`);
      if (person.work.trim()) facts.push(`- ${person.name} worked as ${person.work}.`);
      if (person.wifeName) facts.push(`- ${person.name}'s wife is ${person.wifeName}.`);
      if (person.siblingNames.length > 0) facts.push(`- ${person.name}'s siblings are ${joinNames(person.siblingNames)}.`);
      return facts;
    })
    .slice(0, 120);
  if (lines.length === 0) return "";
  return `Family tree recorded from tagged photos. A line here replaces only that parent link.\n${lines.join("\n")}`;
}
