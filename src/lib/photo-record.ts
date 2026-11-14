import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { republishImageContext } from "@/lib/image-context";
import {
  describePhotoRecord,
  emptyPhotoRecord,
  familyNames,
  normalizeName,
  normalizeRotation,
  sameName,
  splitParents,
  turnPoint,
  turnRotation,
  type ItemTypeId,
  type Person,
  type PersonAvatar,
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

export async function readPhotoMarks(): Promise<Record<string, { note: string; tagged: boolean; people: string; families: string[]; rotation: number }>> {
  const store = await readStore();
  return Object.fromEntries(
    Object.entries(store.photos).map(([sourcePath, record]) => [
      sourcePath,
      {
        note: record.note,
        tagged: record.types.length + record.categories.length + record.pins.length > 0 || Boolean(record.note.trim()),
        people: record.pins
          .filter((pin) => pin.kind === "person")
          .map((pin) => pin.label)
          .join(" "),
        families: [
          ...new Map(
            record.pins
              .filter((pin) => pin.kind === "person")
              .flatMap((pin) => familyNames(pin.label).map((name) => [normalizeName(name), name] as const)),
          ).values(),
        ],
        rotation: record.rotation,
      },
    ]),
  );
}

export async function readTaggedPhotos(): Promise<Array<{ sourcePath: string; personIds: string[]; rotation: number }>> {
  const store = await readStore();
  return Object.values(store.photos).flatMap((record) => {
    const personIds = record.pins.flatMap((pin) => (pin.kind === "person" && pin.personId ? [pin.personId] : []));
    return personIds.length > 0 ? [{ sourcePath: record.sourcePath, personIds, rotation: record.rotation }] : [];
  });
}

export async function readPersonDocuments(personId: string): Promise<Array<{ sourcePath: string; filename: string; label: string }>> {
  const store = await readStore();
  const written = new Set(["letter", "postcard", "record"]);
  return Object.values(store.photos).flatMap((record) => {
    const tagged = record.pins.some((pin) => pin.kind === "person" && pin.personId === personId);
    const kinds = record.types.filter((type) => written.has(type));
    if (!tagged || kinds.length === 0) return [];
    const filename = record.sourcePath.split("/").pop() || record.sourcePath;
    const label = kinds.map((type) => ITEM_TYPES.find((item) => item.id === type)?.label ?? type).join(", ");
    return [{ sourcePath: record.sourcePath, filename, label }];
  });
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

export async function movePhotoTag(sourcePath: string, pinId: string, x: unknown, y: unknown): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  if (!pinId) throw new Error("Choose a tag.");
  if (typeof x !== "number" || typeof y !== "number" || x < 0 || y < 0 || x > 1 || y > 1) throw new Error("Click a spot on the photo.");

  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  const pin = record.pins.find((item) => item.id === pinId);
  if (!pin) throw new Error("Choose a tag.");
  pin.x = x;
  pin.y = y;
  record.updatedAt = new Date().toISOString();
  store.photos[sourcePath] = record;
  await writeStore(store);
  return { categories: store.categories, people: store.people, record };
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

export async function rotatePhoto(sourcePath: string, direction: unknown): Promise<PhotoLibrary> {
  assertPath(sourcePath);
  if (direction !== "left" && direction !== "right") throw new Error("Choose left or right.");
  const store = await readStore();
  const record = store.photos[sourcePath] ?? emptyPhotoRecord(sourcePath);
  record.rotation = turnRotation(record.rotation, direction);
  record.pins = record.pins.map((pin) => ({ ...pin, ...turnPoint(pin.x, pin.y, direction) }));
  record.updatedAt = new Date().toISOString();
  const bare =
    record.rotation === 0 && record.types.length === 0 && record.categories.length === 0 && record.pins.length === 0 && !record.note.trim();
  if (bare) delete store.photos[sourcePath];
  else store.photos[sourcePath] = record;
  await writeStore(store);
  return { categories: store.categories, people: store.people, record };
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
  const person = named ?? current ?? { id: randomUUID(), name: typedName, role: "" as const, parentNames: [], siblingNames: [], wifeName: "", born: "", died: "", birthplace: "", home: "", school: "", work: "" };
  if (!named && !current) store.people.push(person);
  person.name = named && current && named.id !== current.id ? named.name : typedName;
  person.role = role;
  person.parentNames = parentNames;
  return person;
}

function parentNamesFrom(value: unknown, store: Store): string[] {
  return namesFrom(value, store, 4);
}

export async function updatePersonFamily(
  id: string,
  input: {
    name?: unknown;
    role?: unknown;
    parents?: unknown;
    siblings?: unknown;
    wife?: unknown;
    born?: unknown;
    died?: unknown;
    birthplace?: unknown;
    home?: unknown;
    school?: unknown;
    work?: unknown;
  },
): Promise<{ people: Person[]; id: string }> {
  const store = await readStore();
  const person = store.people.find((item) => item.id === id);
  if (!person) throw new Error("Choose a person.");
  const typedName = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : person.name;
  if (!normalizeName(typedName)) throw new Error("Type a name.");
  renamePerson(store, person, typedName);

  const role = input.role === "daughter" || input.role === "son" ? input.role : "";
  const parentNames = parentNamesFrom(input.parents, store);
  const siblingNames = namesFrom(input.siblings, store, 8);
  const wife = typeof input.wife === "string" ? input.wife.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if ((role && parentNames.length === 0) || (!role && parentNames.length > 0)) {
    throw new Error("Choose daughter or son, and name at least one parent.");
  }
  if (parentNames.some((name) => sameName(name, person.name))) throw new Error("A person cannot be their own parent.");
  if (siblingNames.some((name) => sameName(name, person.name))) throw new Error("A person cannot be their own sibling.");
  if (siblingNames.some((name) => parentNames.some((parent) => sameName(parent, name)))) throw new Error("A sibling is not a parent.");
  if (wife && sameName(wife, person.name)) throw new Error("A person cannot be their own wife.");
  if (wife && (parentNames.some((name) => sameName(name, wife)) || siblingNames.some((name) => sameName(name, wife)))) {
    throw new Error("A wife is not a parent or a sibling.");
  }

  for (const name of [...parentNames, ...siblingNames]) ensurePerson(store, name);
  if (wife) ensurePerson(store, wife);
  const nextSiblings = siblingNames.map((name) => canonicalName(store, name));
  const nextWife = wife ? canonicalName(store, wife) : "";
  for (const name of nextSiblings) {
    const other = store.people.find((item) => sameName(item.name, name));
    if (other?.parentNames.some((parent) => sameName(parent, person.name))) throw new Error("A child is not a sibling.");
  }

  for (const name of person.siblingNames) {
    if (nextSiblings.some((item) => sameName(item, name))) continue;
    const other = store.people.find((item) => sameName(item.name, name));
    if (!other) continue;
    other.siblingNames = other.siblingNames.filter((item) => !sameName(item, person.name));
  }
  person.role = role;
  person.parentNames = parentNames;
  person.siblingNames = nextSiblings;
  person.wifeName = nextWife;
  person.born = cleanDate(input.born, person.born);
  person.died = cleanDate(input.died, person.died);
  person.birthplace = cleanLine(input.birthplace, person.birthplace);
  person.home = cleanLine(input.home, person.home);
  person.school = cleanLine(input.school, person.school);
  person.work = cleanLine(input.work, person.work);
  for (const name of nextSiblings) {
    const other = store.people.find((item) => sameName(item.name, name));
    if (!other || other.siblingNames.some((item) => sameName(item, person.name))) continue;
    other.siblingNames = [...other.siblingNames, person.name].slice(0, 8);
  }

  await writeStore(store);
  return { people: store.people, id: person.id };
}

export async function savePersonLinks(input: {
  name: string;
  role: "" | "daughter" | "son";
  parents: string[];
  siblings: string[];
  wife: string;
  born: string;
  children: Array<{ name: string; role: "daughter" | "son" }>;
}): Promise<void> {
  const existing = (await readPeople()).find((person) => sameName(person.name, input.name));
  const body = {
    name: input.name,
    role: input.role,
    parents: input.parents,
    siblings: input.siblings,
    wife: input.wife,
    born: input.born,
  };
  if (existing) await updatePersonFamily(existing.id, body);
  else await createPersonFamily(body);
  await syncLiveHousehold(input.name, input.wife, input.children, true);
}

export async function combineLiveNames(keepName: string, dropName: string): Promise<void> {
  const keep = keepName.trim().replace(/\s+/g, " ");
  const drop = dropName.trim().replace(/\s+/g, " ");
  if (!keep || !drop || sameName(keep, drop)) throw new Error("Choose a different person.");
  const store = await readStore();
  const kept = store.people.find((person) => sameName(person.name, keep));
  const dropped = store.people.find((person) => sameName(person.name, drop) && person.id !== kept?.id);
  if (kept && dropped) {
    mergeLivePerson(kept, dropped);
    for (const record of Object.values(store.photos)) {
      for (const pin of record.pins) {
        if (pin.personId !== dropped.id) continue;
        pin.personId = kept.id;
        pin.label = kept.name;
      }
    }
    store.people = store.people.filter((person) => person.id !== dropped.id);
  } else if (dropped) {
    renamePerson(store, dropped, keep);
  }
  for (const person of store.people) {
    person.parentNames = person.parentNames.map((name) => (sameName(name, drop) ? keep : name));
    person.siblingNames = person.siblingNames.map((name) => (sameName(name, drop) ? keep : name));
    if (sameName(person.wifeName, drop)) person.wifeName = keep;
    stripLiveSelf(person);
  }
  if (!store.people.some((person) => sameName(person.name, keep))) {
    store.people.push({ id: randomUUID(), name: keep, role: "", parentNames: [], siblingNames: [], wifeName: "", born: "", died: "", birthplace: "", home: "", school: "", work: "" });
  }
  await writeStore(store);
}

export async function fillLiveFromDraft(input: {
  name: string;
  role: "" | "daughter" | "son";
  parents: string[];
  siblings: string[];
  wife: string;
  born: string;
  children: Array<{ name: string; role: "daughter" | "son" }>;
}): Promise<void> {
  const live = (await readPeople()).find((person) => sameName(person.name, input.name));
  if (!live) {
    await savePersonLinks(input);
    return;
  }
  const role = live.role || input.role;
  const parents = live.parentNames.length > 0 ? live.parentNames : role ? input.parents.slice(0, 4) : [];
  const wife = live.wifeName || input.wife;
  const siblings = [...live.siblingNames];
  for (const name of input.siblings) {
    if (siblings.length >= 8) break;
    if (siblings.some((item) => sameName(item, name)) || sameName(name, input.name) || sameName(name, wife) || parents.some((parent) => sameName(parent, name))) continue;
    siblings.push(name);
  }
  const nextRole = parents.length > 0 && (role === "daughter" || role === "son") ? role : "";
  if (nextRole || parents.length === 0) {
    await updatePersonFamily(live.id, {
      name: live.name,
      role: nextRole,
      parents: nextRole ? parents : [],
      siblings,
      wife,
      born: live.born || input.born,
    });
  }
  await syncLiveHousehold(input.name, wife, input.children, false);
}

async function syncLiveHousehold(name: string, wife: string, children: Array<{ name: string; role: "daughter" | "son" }>, replace: boolean): Promise<void> {
  const store = await readStore();
  const person = store.people.find((item) => sameName(item.name, name));
  if (!person) return;
  for (const other of store.people) {
    if (other.id === person.id) continue;
    if (sameName(other.wifeName, person.name) && !sameName(other.name, wife)) other.wifeName = "";
  }
  if (wife) {
    ensurePerson(store, wife);
    const partner = store.people.find((item) => sameName(item.name, wife));
    if (partner && !sameName(partner.name, person.name)) partner.wifeName = person.name;
  }
  if (replace) {
    for (const child of store.people) {
      if (!child.parentNames.some((parent) => sameName(parent, person.name))) continue;
      if (children.some((item) => sameName(item.name, child.name))) continue;
      child.parentNames = child.parentNames.filter((parent) => !sameName(parent, person.name));
      if (child.parentNames.length === 0) child.role = "";
    }
  }
  for (const link of children) {
    if (sameName(link.name, person.name) || sameName(link.name, wife) || person.parentNames.some((parent) => sameName(parent, link.name))) continue;
    ensurePerson(store, link.name);
    const child = store.people.find((item) => sameName(item.name, link.name));
    if (!child || child.id === person.id) continue;
    if (!child.parentNames.some((parent) => sameName(parent, person.name))) {
      if (child.parentNames.length >= 4) throw new Error(`${child.name} already has four parents.`);
      child.parentNames.push(person.name);
    }
    child.role = link.role;
  }
  await writeStore(store);
}

function mergeLivePerson(kept: Person, other: Person) {
  if (!kept.role && other.role) kept.role = other.role;
  for (const name of other.parentNames) {
    if (kept.parentNames.length >= 4) break;
    if (kept.parentNames.some((item) => sameName(item, name)) || sameName(name, kept.name)) continue;
    kept.parentNames.push(name);
  }
  const wife = kept.wifeName || other.wifeName;
  for (const name of other.siblingNames) {
    if (kept.siblingNames.length >= 8) break;
    if (kept.siblingNames.some((item) => sameName(item, name)) || sameName(name, kept.name) || sameName(name, wife) || kept.parentNames.some((parent) => sameName(parent, name))) continue;
    kept.siblingNames.push(name);
  }
  if (wife && !sameName(wife, kept.name) && !kept.parentNames.some((parent) => sameName(parent, wife)) && !kept.siblingNames.some((name) => sameName(name, wife))) kept.wifeName = wife;
  if (!kept.born && other.born) kept.born = other.born;
  if (!kept.died && other.died) kept.died = other.died;
  if (!kept.birthplace && other.birthplace) kept.birthplace = other.birthplace;
  if (!kept.home && other.home) kept.home = other.home;
  if (!kept.school && other.school) kept.school = other.school;
  if (!kept.work && other.work) kept.work = other.work;
  if (!kept.avatar && other.avatar) kept.avatar = other.avatar;
}

function stripLiveSelf(person: Person) {
  person.parentNames = person.parentNames.filter((name, index, list) => !sameName(name, person.name) && list.findIndex((item) => sameName(item, name)) === index).slice(0, 4);
  if (person.parentNames.length === 0) person.role = "";
  if (sameName(person.wifeName, person.name) || person.parentNames.some((name) => sameName(name, person.wifeName))) person.wifeName = "";
  person.siblingNames = person.siblingNames
    .filter((name, index, list) => !sameName(name, person.name) && !sameName(name, person.wifeName) && !person.parentNames.some((parent) => sameName(parent, name)) && list.findIndex((item) => sameName(item, name)) === index)
    .slice(0, 8);
}

export async function setPersonAvatar(id: string, input: unknown): Promise<{ people: Person[] }> {
  const store = await readStore();
  const person = store.people.find((item) => item.id === id);
  if (!person) throw new Error("Choose a person.");
  if (input == null) {
    delete person.avatar;
    await writeStore(store);
    return { people: store.people };
  }
  const avatar = cleanAvatar(input);
  if (!avatar) throw new Error("Drag the crop onto the photo.");
  const record = store.photos[avatar.sourcePath];
  const tagged = record?.pins.some((pin) => pin.kind === "person" && pin.personId === person.id);
  if (!tagged) throw new Error("Choose a photo of this person.");
  person.avatar = avatar;
  await writeStore(store);
  return { people: store.people };
}

export async function createPersonFamily(input: {
  name?: unknown;
  role?: unknown;
  parents?: unknown;
  siblings?: unknown;
  wife?: unknown;
  born?: unknown;
  died?: unknown;
  birthplace?: unknown;
  home?: unknown;
  school?: unknown;
  work?: unknown;
}): Promise<{ people: Person[]; id: string }> {
  const typedName = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!normalizeName(typedName)) throw new Error("Type a name.");
  const store = await readStore();
  const existing = store.people.find((item) => sameName(item.name, typedName));
  const role = input.role === "daughter" || input.role === "son" ? input.role : "";
  const hasParents = Array.isArray(input.parents) ? input.parents.some((item) => typeof item === "string" && item.trim()) : typeof input.parents === "string" && input.parents.trim().length > 0;
  const hasSiblings = Array.isArray(input.siblings) ? input.siblings.some((item) => typeof item === "string" && item.trim()) : typeof input.siblings === "string" && input.siblings.trim().length > 0;
  const hasWife = typeof input.wife === "string" && input.wife.trim().length > 0;
  const hasDates = [input.born, input.died, input.birthplace, input.home, input.school, input.work].some((value) => typeof value === "string" && value.trim().length > 0);
  if (existing && !role && !hasParents && !hasSiblings && !hasWife && !hasDates) return { people: store.people, id: existing.id };
  let id = existing?.id;
  if (!id) {
    id = randomUUID();
    store.people.push({ id, name: typedName, role: "", parentNames: [], siblingNames: [], wifeName: "", born: "", died: "", birthplace: "", home: "", school: "", work: "" });
    await writeStore(store);
  }
  try {
    return await updatePersonFamily(id, input);
  } catch (error) {
    if (!existing) {
      const rollback = await readStore();
      rollback.people = rollback.people.filter((item) => item.id !== id);
      await writeStore(rollback);
    }
    throw error;
  }
}

function renamePerson(store: Store, person: Person, nextName: string) {
  const previous = person.name;
  if (previous === nextName) return;
  if (store.people.some((item) => item.id !== person.id && sameName(item.name, nextName))) {
    throw new Error("That name is already in the family.");
  }
  const replace = (name: string) => (sameName(name, previous) ? nextName : name);
  for (const other of store.people) {
    other.parentNames = other.parentNames.map(replace);
    other.siblingNames = other.siblingNames.map(replace);
    if (sameName(other.wifeName, previous)) other.wifeName = nextName;
  }
  for (const record of Object.values(store.photos)) {
    for (const pin of record.pins) {
      if (pin.personId === person.id) pin.label = nextName;
    }
  }
  person.name = nextName;
}

function cleanDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return fallback;
  return trimmed;
}

function cleanLine(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function namesFrom(value: unknown, store: Store, limit: number): string[] {
  const pieces = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const names: string[] = [];
  for (const piece of pieces) {
    if (typeof piece !== "string") continue;
    for (const name of splitParents(piece)) {
      const canonical = canonicalName(store, name);
      if (names.some((item) => sameName(item, canonical))) continue;
      names.push(canonical);
      if (names.length === limit) return names;
    }
  }
  return names;
}

function canonicalName(store: Store, name: string): string {
  return store.people.find((person) => sameName(person.name, name))?.name ?? name;
}

function ensurePerson(store: Store, name: string) {
  if (store.people.some((person) => sameName(person.name, name))) return;
  store.people.push({ id: randomUUID(), name, role: "", parentNames: [], siblingNames: [], wifeName: "", born: "", died: "", birthplace: "", home: "", school: "", work: "" });
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
  const siblingNames = Array.isArray(person.siblingNames)
    ? person.siblingNames.filter((name): name is string => typeof name === "string" && Boolean(normalizeName(name))).slice(0, 8)
    : [];
  const wifeName = typeof person.wifeName === "string" ? person.wifeName.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const born = cleanDate(person.born, "");
  const died = cleanDate(person.died, "");
  const birthplace = cleanLine(person.birthplace, "");
  const home = cleanLine(person.home, "");
  const school = cleanLine(person.school, "");
  const work = cleanLine(person.work, "");
  const avatar = cleanAvatar(person.avatar);
  return [{ id: typeof person.id === "string" ? person.id : randomUUID(), name: person.name.trim(), role, parentNames, siblingNames, wifeName, born, died, birthplace, home, school, work, ...(avatar ? { avatar } : {}) }];
}

function cleanAvatar(value: unknown): PersonAvatar | undefined {
  const avatar = value as Partial<PersonAvatar> | null;
  if (!avatar || typeof avatar.sourcePath !== "string" || !avatar.sourcePath || avatar.sourcePath.includes("..") || avatar.sourcePath.includes("\0")) return undefined;
  const x = finite(avatar.x);
  const y = finite(avatar.y);
  const w = finite(avatar.w);
  const h = finite(avatar.h);
  if (x == null || y == null || w == null || h == null) return undefined;
  if (x < 0 || y < 0 || w < 0.04 || h < 0.04 || x + w > 1.02 || y + h > 1.02) return undefined;
  const width = Math.min(w, 1 - x);
  const height = Math.min(h, 1 - y);
  return { sourcePath: avatar.sourcePath, x: roundCrop(x), y: roundCrop(y), w: roundCrop(width), h: roundCrop(height) };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundCrop(value: number): number {
  return Math.round(value * 10000) / 10000;
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
      rotation: normalizeRotation(typeof raw?.rotation === "number" ? raw.rotation : 0),
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

export async function forgetPhoto(sourcePath: string): Promise<void> {
  if (!sourcePath || sourcePath.includes("..")) return;
  const store = await readStore();
  if (!store.photos[sourcePath]) return;
  delete store.photos[sourcePath];
  await writeStore(store);
}

async function writeStore(store: Store): Promise<void> {
  const photos = Object.fromEntries(
    Object.entries(store.photos).map(([sourcePath, record]) => {
      if (record.rotation) return [sourcePath, record];
      const { rotation: _rotation, ...rest } = record;
      return [sourcePath, rest];
    }),
  );
  const people = store.people.map((person) => {
    const { born, died, birthplace, home, school, work, ...rest } = person;
    return {
      ...rest,
      ...(born ? { born } : {}),
      ...(died ? { died } : {}),
      ...(birthplace ? { birthplace } : {}),
      ...(home ? { home } : {}),
      ...(school ? { school } : {}),
      ...(work ? { work } : {}),
    };
  });
  await writeFile(FILE, JSON.stringify({ ...store, people, photos }, null, 2));
}
