import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { republishImageContext } from "@/lib/image-context";
import {
  describePhotoRecord,
  emptyPhotoRecord,
  normalizeName,
  sameName,
  splitParents,
  type ItemTypeId,
  type Person,
  type PhotoPin,
  type PhotoRecord,
  ITEM_TYPES,
} from "@/lib/photo-types";

const FILE = path.join("data", "photo-records.json");

type Store = {
  categories: string[];
  people: Person[];
  photos: Record<string, PhotoRecord>;
};

export type PhotoLibrary = {
  categories: string[];
  people: Person[];
  record: PhotoRecord;
  warning?: string;
};

export async function readPeople(): Promise<Person[]> {
  return (await readStore()).people;
}

export async function readPhotoMarks(): Promise<Record<string, { note: string; tagged: boolean }>> {
  const store = await readStore();
  return Object.fromEntries(
    Object.entries(store.photos).map(([sourcePath, record]) => [
      sourcePath,
      {
        note: record.note,
        tagged: record.types.length + record.categories.length + record.pins.length > 0 || Boolean(record.note.trim()),
      },
    ]),
  );
}

export async function readPhotoLibrary(sourcePath: string): Promise<PhotoLibrary> {
  const store = await readStore();
  return {
    categories: store.categories,
    people: store.people,
    record: store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath),
  };
}

export async function assignPhotoCategories(sourcePath: string, types: unknown, categories: unknown): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  record.types = cleanTypes(types);
  record.categories = cleanCategories(categories).map((name) => store.categories.find((category) => sameName(category, name)) ?? name);
  for (const category of record.categories) rememberCategory(store, category);
  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  const warning = await publish(sourcePath, record, store.people);
  return { categories: store.categories, people: store.people, record, warning };
}

export async function addPhotoTag(
  sourcePath: string,
  input: { x?: unknown; y?: unknown; kind?: unknown; name?: unknown; role?: unknown; parents?: unknown },
): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  const x = typeof input.x === "number" ? input.x : Number.NaN;
  const y = typeof input.y === "number" ? input.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error("Click a spot on the photo.");
  const kind = input.kind === "thing" ? "thing" : input.kind === "person" ? "person" : "";
  if (!kind) throw new Error("Choose a person or a thing.");
  const typedName = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!typedName) throw new Error("Type a name.");

  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  if (record.pins.length >= 40) throw new Error("This photo already has 40 tags.");

  let label = typedName;
  let personId: string | undefined;
  if (kind === "person") {
    const linked = linkPerson(store, typedName, input.role, input.parents, undefined, true);
    label = linked.name;
    personId = linked.id;
  }

  const pin: PhotoPin = { id: randomUUID(), x, y, kind, label, personId };
  record.pins.push(pin);
  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  const warning = await publish(sourcePath, record, store.people);
  return { categories: store.categories, people: store.people, record, warning };
}

export async function updatePhotoTag(
  sourcePath: string,
  input: { pinId?: unknown; kind?: unknown; name?: unknown; role?: unknown; parents?: unknown },
): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  const pinId = typeof input.pinId === "string" ? input.pinId : "";
  const typedName = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!pinId) throw new Error("Choose a tag.");
  if (!typedName) throw new Error("Type a name.");

  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  const pin = record.pins.find((item) => item.id === pinId);
  if (!pin) throw new Error("Choose a tag.");

  const kind = input.kind === "thing" ? "thing" : "person";
  if (kind === "thing") {
    pin.kind = "thing";
    pin.label = typedName;
    pin.personId = undefined;
  } else {
    const linked = linkPerson(store, typedName, input.role, input.parents, pin.personId);
    pin.kind = "person";
    pin.label = linked.name;
    pin.personId = linked.id;
    for (const photo of Object.values(store.photos)) {
      for (const item of photo.pins) {
        if (item.personId === linked.id) item.label = linked.name;
      }
    }
  }

  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  const warning = await publish(sourcePath, record, store.people);
  return { categories: store.categories, people: store.people, record, warning };
}

export async function removePhotoTag(sourcePath: string, pinId: string): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  if (!pinId) throw new Error("Choose a tag.");
  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  record.pins = record.pins.filter((pin) => pin.id !== pinId);
  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  const warning = await publish(sourcePath, record, store.people);
  return { categories: store.categories, people: store.people, record, warning };
}

export async function savePhotoNote(sourcePath: string, note: unknown): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  record.note = text;
  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  const warning = await publish(sourcePath, record, store.people);
  return { categories: store.categories, people: store.people, record, warning };
}

function assertPath(sourcePath: string) {
  if (!sourcePath || sourcePath.includes("..")) throw new Error("Choose a photo.");
}

function cleanTypes(value: unknown): ItemTypeId[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(ITEM_TYPES.map((item) => item.id));
  const types: ItemTypeId[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item as ItemTypeId) || types.includes(item as ItemTypeId)) continue;
    types.push(item as ItemTypeId);
  }
  return types;
}

function cleanCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const categories: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name || categories.some((category) => sameName(category, name))) continue;
    categories.push(name);
    if (categories.length === 12) break;
  }
  return categories;
}

function rememberCategory(store: Store, name: string) {
  if (store.categories.some((category) => sameName(category, name))) return;
  store.categories.push(name);
  store.categories.sort((a, b) => a.localeCompare(b));
}

function linkPerson(
  store: Store,
  typedName: string,
  roleValue: unknown,
  parentsValue: unknown,
  currentId?: string,
  keepExisting = false,
): Person {
  const role = roleValue === "daughter" || roleValue === "son" ? roleValue : "";
  const parentNames = parentNamesFrom(parentsValue, store);
  if ((role && parentNames.length === 0) || (!role && parentNames.length > 0)) {
    throw new Error("Choose daughter or son, and name at least one parent.");
  }
  if (parentNames.some((name) => sameName(name, typedName))) throw new Error("A person cannot be their own parent.");

  const current = currentId ? store.people.find((person) => person.id === currentId) : undefined;
  const named = store.people.find((person) => sameName(person.name, typedName));
  if (keepExisting && named && !role && parentNames.length === 0) return named;

  for (const parentName of parentNames) ensurePerson(store, parentName);
  const person = named ?? current ?? { id: randomUUID(), name: typedName, role: "" as const, parentNames: [] };
  if (!named && !current) store.people.push(person);
  person.name = named && current && named.id !== current.id ? named.name : typedName;
  person.role = role;
  person.parentNames = parentNames;
  return person;
}

function parentNamesFrom(value: unknown, store: Store): string[] {
  const pieces = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const names: string[] = [];
  for (const piece of pieces) {
    if (typeof piece !== "string") continue;
    for (const name of splitParents(piece)) {
      const canonical = canonicalName(store, name);
      if (names.some((item) => sameName(item, canonical))) continue;
      names.push(canonical);
      if (names.length === 4) return names;
    }
  }
  return names;
}

function canonicalName(store: Store, name: string): string {
  return store.people.find((person) => sameName(person.name, name))?.name ?? name;
}

function ensurePerson(store: Store, name: string) {
  if (store.people.some((person) => sameName(person.name, name))) return;
  store.people.push({ id: randomUUID(), name, role: "", parentNames: [] });
}

async function publish(sourcePath: string, record: PhotoRecord, people: Person[]): Promise<string | undefined> {
  try {
    await republishImageContext(sourcePath, describePhotoRecord(record, people));
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pool|database|prisma|reach database/i.test(message)) {
      return "Saved on this Mac. The chat index will update when the database is reachable.";
    }
    return "Saved on this Mac. The chat index could not be updated.";
  }
}

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<Store>;
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories.filter((item) => typeof item === "string") : [],
      people: Array.isArray(parsed.people) ? parsed.people.flatMap(cleanPerson) : [],
      photos: parsed.photos && typeof parsed.photos === "object" ? cleanPhotos(parsed.photos) : {},
    };
  } catch {
    return { categories: [], people: [], photos: {} };
  }
}

function cleanPerson(value: unknown): Person[] {
  const person = value as Partial<Person>;
  if (typeof person.name !== "string" || !normalizeName(person.name)) return [];
  const role = person.role === "daughter" || person.role === "son" ? person.role : "";
  const parentNames = Array.isArray(person.parentNames)
    ? person.parentNames.filter((name): name is string => typeof name === "string" && Boolean(normalizeName(name))).slice(0, 4)
    : [];
  return [{ id: typeof person.id === "string" ? person.id : randomUUID(), name: person.name.trim(), role, parentNames }];
}

function cleanPhotos(value: object): Record<string, PhotoRecord> {
  const photos: Record<string, PhotoRecord> = {};
  for (const [sourcePath, raw] of Object.entries(value as Record<string, Partial<PhotoRecord>>)) {
    if (!sourcePath || sourcePath.includes("..")) continue;
    photos[sourcePath] = {
      sourcePath,
      types: cleanTypes(raw?.types),
      categories: cleanCategories(raw?.categories),
      pins: Array.isArray(raw?.pins) ? raw.pins.flatMap(cleanPin) : [],
      note: typeof raw?.note === "string" ? raw.note.slice(0, 2000) : "",
      updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : "",
    };
  }
  return photos;
}

function cleanPin(value: unknown): PhotoPin[] {
  const pin = value as Partial<PhotoPin>;
  if (pin.kind !== "person" && pin.kind !== "thing") return [];
  if (typeof pin.label !== "string" || !pin.label.trim()) return [];
  if (typeof pin.x !== "number" || typeof pin.y !== "number") return [];
  return [
    {
      id: typeof pin.id === "string" ? pin.id : randomUUID(),
      x: pin.x,
      y: pin.y,
      kind: pin.kind,
      label: pin.label,
      personId: typeof pin.personId === "string" ? pin.personId : undefined,
    },
  ];
}

async function writeStore(store: Store): Promise<void> {
  await writeFile(FILE, JSON.stringify(store, null, 2));
}
