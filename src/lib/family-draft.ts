import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { combineLiveNames, createPersonFamily, fillLiveFromDraft, readPeople, savePersonLinks, updatePersonFamily } from "@/lib/photo-record";
import { upstashVectorCredentials } from "@/lib/prisma";
import { sameName } from "@/lib/photo-types";

export type DraftPerson = {
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
  sources: string[];
};

export type DraftLog = { at: string; message: string };

export type FamilyDraft = {
  state: "idle" | "running" | "ready" | "failed";
  phase: string;
  startedAt: string | null;
  updatedAt: string;
  pagesSeen: number;
  familyPages: number;
  pagesRead: number;
  people: DraftPerson[];
  log: DraftLog[];
  error: string | null;
  appliedAt: string | null;
  added: number;
  updated: number;
};

const FILE = path.join("data", "family-draft.json");
const NOTES = path.join("data", "relationship-notes.json");
const FAMILY_ROLE = /^(?:daughter|son|father|mother|parent|wife|husband|spouse|brother|sister|sibling|school|work|job|occupation)$/i;

type NoteCache = Record<string, { chars: number; notes: string }>;

const globalDraft = globalThis as { husfeldDraft?: Promise<void> };

export function draftScanActive(): boolean {
  return Boolean(globalDraft.husfeldDraft);
}

export async function readDraft(): Promise<FamilyDraft> {
  const draft = await loadDraft();
  if (draft.state === "running" && !draftScanActive()) {
    const age = Date.now() - Date.parse(draft.updatedAt);
    if (Number.isFinite(age) && age > 20000) {
      draft.state = "failed";
      draft.error = "The scan stopped. Start it again to continue from the pages already read.";
      draft.phase = draft.error;
      await writeDraft(draft);
    }
  }
  return draft;
}

export function startDraftScan(): void {
  if (globalDraft.husfeldDraft) return;
  globalDraft.husfeldDraft = runScan().finally(() => {
    globalDraft.husfeldDraft = undefined;
  });
}

export async function updateDraftLinks(input: unknown): Promise<FamilyDraft> {
  const body = input as { id?: unknown; name?: unknown; role?: unknown; parents?: unknown; siblings?: unknown; wife?: unknown; children?: unknown; born?: unknown };
  const draft = await readDraft();
  if (draft.state === "running") throw new Error("Wait until the scan finishes.");
  const named = linkName(body.name);
  let person = typeof body.id === "string" ? draft.people.find((item) => item.id === body.id) : undefined;
  if (!person && named) person = ensureDraftPerson(draft, named);
  if (!person) throw new Error("That person is not in the draft.");
  const parents = uniqueNames(body.parents).filter((name) => !sameName(name, person.name)).slice(0, 4);
  const wife = linkName(body.wife);
  const siblings = uniqueNames(body.siblings).filter((name) => !sameName(name, person.name) && !sameName(name, wife) && !parents.some((parent) => sameName(parent, name))).slice(0, 8);
  const role = body.role === "daughter" || body.role === "son" ? body.role : "";
  if ((parents.length > 0 && !role) || (role && parents.length === 0)) throw new Error("Choose daughter or son, and name at least one parent.");
  if (wife && (sameName(wife, person.name) || parents.some((parent) => sameName(parent, wife)) || siblings.some((name) => sameName(name, wife)))) {
    throw new Error("A spouse cannot be the same person, a parent, or a sibling.");
  }
  const children = linkChildren(body.children).filter((child) => !sameName(child.name, person.name) && !parents.some((parent) => sameName(parent, child.name)) && !sameName(child.name, wife));

  const previousSiblings = person.siblingNames;
  const previousWife = person.wifeName;
  person.role = role;
  person.parentNames = parents;
  person.siblingNames = siblings;
  person.wifeName = wife;
  person.born = cleanBorn(body.born, person.born);
  for (const name of parents) ensureDraftPerson(draft, name);
  for (const name of previousSiblings) {
    if (siblings.some((item) => sameName(item, name))) continue;
    const other = draft.people.find((item) => sameName(item.name, name));
    if (other) other.siblingNames = other.siblingNames.filter((item) => !sameName(item, person.name));
  }
  for (const name of siblings) {
    const other = ensureDraftPerson(draft, name);
    if (!other.siblingNames.some((item) => sameName(item, person.name)) && other.siblingNames.length < 8) other.siblingNames.push(person.name);
  }
  if (previousWife && !sameName(previousWife, wife)) {
    const old = draft.people.find((item) => sameName(item.name, previousWife));
    if (old && sameName(old.wifeName, person.name)) old.wifeName = "";
  }
  if (wife) {
    const partner = ensureDraftPerson(draft, wife);
    if (partner.wifeName && !sameName(partner.wifeName, person.name)) {
      const displaced = draft.people.find((item) => sameName(item.name, partner.wifeName));
      if (displaced && sameName(displaced.wifeName, partner.name)) displaced.wifeName = "";
    }
    partner.wifeName = person.name;
  }
  for (const child of draft.people) {
    if (child.id === person.id || !child.parentNames.some((name) => sameName(name, person.name))) continue;
    if (children.some((item) => sameName(item.name, child.name))) continue;
    child.parentNames = child.parentNames.filter((name) => !sameName(name, person.name));
    if (child.parentNames.length === 0) child.role = "";
  }
  for (const childLink of children) {
    const child = ensureDraftPerson(draft, childLink.name);
    if (!child.parentNames.some((name) => sameName(name, person.name))) {
      if (child.parentNames.length >= 4) throw new Error(`${child.name} already has four parents.`);
      child.parentNames.push(person.name);
    }
    child.role = childLink.role;
  }
  await savePersonLinks({
    name: person.name,
    role,
    parents,
    siblings,
    wife,
    born: person.born,
    children,
  });
  note(draft, `Linked ${person.name}.`);
  await writeDraft(draft);
  return draft;
}

export async function combineDraftNames(input: unknown): Promise<FamilyDraft> {
  const body = input as { name?: unknown; with?: unknown };
  const keepName = linkName(body.name);
  const dropName = linkName(body.with);
  if (!keepName || !dropName) throw new Error("Choose a person to combine with.");
  if (sameName(keepName, dropName)) throw new Error("Choose a different person.");
  const draft = await readDraft();
  if (draft.state === "running") throw new Error("Wait until the scan finishes.");
  const kept = ensureDraftPerson(draft, keepName);
  rewriteDraftNames(draft, dropName, kept.name);
  const duplicates = draft.people.filter((person) => person.id !== kept.id && sameName(person.name, kept.name));
  for (const other of duplicates) mergeDraftPerson(kept, other);
  if (duplicates.length > 0) {
    const dropIds = new Set(duplicates.map((person) => person.id));
    draft.people = draft.people.filter((person) => !dropIds.has(person.id));
  }
  for (const person of draft.people) stripDraftSelf(person);
  const children = draft.people.flatMap((person) => {
    if (person.id === kept.id || (person.role !== "daughter" && person.role !== "son")) return [];
    if (!person.parentNames.some((name) => sameName(name, kept.name))) return [];
    if (sameName(person.name, kept.name) || sameName(person.name, kept.wifeName) || kept.parentNames.some((name) => sameName(name, person.name))) return [];
    return [{ name: person.name, role: person.role }];
  });
  await combineLiveNames(kept.name, dropName);
  await fillLiveFromDraft({
    name: kept.name,
    role: kept.parentNames.length > 0 ? kept.role : "",
    parents: kept.parentNames.length > 0 && kept.role ? kept.parentNames : [],
    siblings: kept.siblingNames,
    wife: kept.wifeName,
    born: kept.born,
    children,
  });
  note(draft, `Combined ${dropName} into ${kept.name}.`);
  await writeDraft(draft);
  return draft;
}

export async function applyDraft(): Promise<FamilyDraft> {
  const draft = await readDraft();
  if (draft.state === "running") throw new Error("Wait until the scan finishes.");
  if (draft.people.length === 0) throw new Error("There is no draft to add.");
  let added = 0;
  let updated = 0;
  const ordered = [...draft.people].sort((a, b) => a.parentNames.length - b.parentNames.length);
  for (const person of ordered) {
    try {
      const live = (await readPeople()).find((item) => sameName(item.name, person.name));
      if (!live) {
        const role = person.role === "daughter" || person.role === "son" ? person.role : "";
        const parents = role ? person.parentNames.filter((name) => !sameName(name, person.name)).slice(0, 4) : [];
        await createPersonFamily({
          name: person.name,
          role: parents.length > 0 ? role : "",
          parents,
          siblings: person.siblingNames.filter((name) => !sameName(name, person.name) && !parents.some((parent) => sameName(parent, name))).slice(0, 8),
          wife: person.wifeName && !sameName(person.wifeName, person.name) ? person.wifeName : "",
          born: person.born,
          died: person.died,
          birthplace: person.birthplace,
          home: person.home,
          school: person.school,
          work: person.work,
        });
        added += 1;
        continue;
      }
      const role = live.role || person.role;
      const parents = live.parentNames.length > 0 ? live.parentNames : role === "daughter" || role === "son" ? person.parentNames.filter((name) => !sameName(name, live.name)).slice(0, 4) : [];
      const wife = live.wifeName || (person.wifeName && !parents.some((name) => sameName(name, person.wifeName)) ? person.wifeName : "");
      const siblings = [...live.siblingNames];
      for (const name of person.siblingNames) {
        if (siblings.length >= 8) break;
        if (siblings.some((item) => sameName(item, name)) || parents.some((item) => sameName(item, name))) continue;
        if (sameName(name, live.name) || sameName(name, wife)) continue;
        siblings.push(name);
      }
      await updatePersonFamily(live.id, {
        role: parents.length > 0 ? role : "",
        parents,
        siblings,
        wife,
        born: live.born || person.born,
        died: live.died || person.died,
        birthplace: live.birthplace || person.birthplace,
        home: live.home || person.home,
        school: live.school || person.school,
        work: live.work || person.work,
      });
      updated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "That person could not be added.";
      note(draft, `${person.name}: ${message}`);
    }
  }
  draft.appliedAt = new Date().toISOString();
  draft.added = added;
  draft.updated = updated;
  draft.phase = `Added ${added} people and filled ${updated} records already in the family.`;
  note(draft, draft.phase);
  await writeDraft(draft);
  return draft;
}

async function runScan(): Promise<void> {
  const draft = emptyDraft();
  draft.state = "running";
  draft.startedAt = new Date().toISOString();
  draft.phase = "Reading the indexed pages.";
  note(draft, draft.phase);
  await writeDraft(draft);
  try {
    const pages = await loadFamilyPages();
    draft.pagesSeen = pages.length;
    draft.familyPages = pages.length;
    draft.phase = pages.length === 0 ? "No family pages were found in the index." : `Found ${pages.length} pages that mention a family.`;
    note(draft, draft.phase);
    await writeDraft(draft);
    if (pages.length === 0) {
      draft.state = "ready";
      await writeDraft(draft);
      return;
    }

    const cache = await readNotes();
    const pending = pages.filter((page) => cache[page.filename]?.chars !== page.text.length);
    const ready = pages.filter((page) => cache[page.filename]?.notes);
    draft.phase = pending.length === 0 ? "Building a draft tree from the notes already saved." : `Building from ${ready.length} saved notes, then reading ${pending.length} new pages.`;
    note(draft, draft.phase);
    await writeDraft(draft);

    for (let index = 0; index < ready.length; index += 24) {
      for (const page of ready.slice(index, index + 24)) absorb(draft, cache[page.filename]?.notes ?? "", page.filename);
      draft.pagesRead = Math.min(ready.length, index + 24);
      draft.phase = `Placed people from ${draft.pagesRead} of ${pages.length} family pages.`;
      await writeDraft(draft);
      await pause(40);
    }

    const batches = pack(pending, 8000);
    let read = ready.length;
    for (const batch of batches) {
      try {
        const extracted = await extractNotes(batch);
        for (const page of batch) {
          const notes = sectionFor(extracted, page.filename);
          cache[page.filename] = { chars: page.text.length, notes };
          absorb(draft, notes, page.filename);
          read += 1;
          note(draft, `Read ${page.filename}.`);
        }
        await writeFile(NOTES, JSON.stringify(cache));
      } catch (error) {
        const message = error instanceof Error ? error.message : "A batch could not be read.";
        note(draft, message);
        read += batch.length;
      }
      draft.pagesRead = Math.min(pages.length, read);
      draft.phase = `Reading the papers. ${draft.pagesRead} of ${pages.length} family pages, ${draft.people.length} people in the draft.`;
      await writeDraft(draft);
    }

    draft.pagesRead = pages.length;
    draft.state = "ready";
    draft.phase = `The draft has ${draft.people.length} people from ${pages.length} pages. Nothing has been added to the family yet.`;
    note(draft, draft.phase);
    await writeDraft(draft);
  } catch (error) {
    draft.state = "failed";
    draft.error = error instanceof Error ? error.message : "The scan could not be finished.";
    draft.phase = draft.error;
    note(draft, draft.phase);
    await writeDraft(draft);
  }
}

function absorb(draft: FamilyDraft, notes: string, filename: string): void {
  for (const line of notes.split("\n")) {
    const text = line.replace(/^[-*]\s*/, "").replace(/\.$/, "").trim();
    if (!text || !text.includes(",")) continue;
    const parts = text.split(",").map((part) => part.trim());
    const name = cleanName(parts[0] ?? "");
    const role = (parts[1] ?? "").toLowerCase();
    const others = otherPeople(parts);
    const detail = [parts[3], parts[4]].filter((part) => part && !/unclear|connected to/i.test(part)).join(", ");
    if (!name || !FAMILY_ROLE.test(role)) continue;
    const person = ensure(draft, name, filename);
    if (!person) continue;
    if (role === "daughter" || role === "son") {
      if (!person.role) person.role = role;
      for (const other of others) {
        addName(person.parentNames, other, 4);
        ensure(draft, other, filename);
      }
    } else if (role === "father" || role === "mother" || role === "parent") {
      for (const other of others) {
        const child = ensure(draft, other, filename);
        if (child) addName(child.parentNames, person.name, 4);
      }
    } else if (role === "wife" || role === "husband" || role === "spouse") {
      const other = others[0] ?? "";
      if (other && !person.wifeName) person.wifeName = other;
      if (other) ensure(draft, other, filename);
    } else if (role === "brother" || role === "sister" || role === "sibling") {
      for (const other of others) {
        addName(person.siblingNames, other, 8);
        const sibling = ensure(draft, other, filename);
        if (sibling) addName(sibling.siblingNames, person.name, 8);
      }
    } else if (role === "school") {
      if (!person.school) person.school = others[0] || detail;
    } else if (role === "work" || role === "job" || role === "occupation") {
      if (!person.work) person.work = others[0] || detail;
    }
    if (/birth|born/i.test(detail) && !person.birthplace && detail) person.birthplace = detail.slice(0, 120);
  }
}

function ensure(draft: FamilyDraft, name: string, filename: string): DraftPerson | null {
  const clean = cleanName(name);
  if (!clean) return null;
  const found = draft.people.find((person) => sameName(person.name, clean));
  if (found) {
    addName(found.sources, filename, 12);
    return found;
  }
  const person: DraftPerson = {
    id: randomUUID(),
    name: clean,
    role: "",
    parentNames: [],
    siblingNames: [],
    wifeName: "",
    born: "",
    died: "",
    birthplace: "",
    home: "",
    school: "",
    work: "",
    sources: [filename],
  };
  draft.people.push(person);
  return person;
}

function addName(names: string[], name: string, limit: number): void {
  const clean = cleanName(name);
  if (!clean || names.length >= limit || names.some((item) => sameName(item, clean))) return;
  names.push(clean);
}

function otherPeople(parts: string[]): string[] {
  const raw = parts[2] ?? "";
  const connected = raw.match(/^connected to\s+(.+)$/i);
  const value = connected ? connected[1] : /^connected to$/i.test(raw) ? (parts[3] ?? "") : raw;
  if (/^(?:mr\.?\s+and\s+mrs\.?|mrs\.?\s+and\s+mr\.?)\s+\S/i.test(value)) {
    const household = value.replace(/\s+/g, " ").trim();
    return household ? [household.slice(0, 80)] : [];
  }
  return value
    .split(/\s+and\s+/i)
    .map((part) => cleanName(part))
    .filter(Boolean);
}

function cleanName(value: string): string {
  const name = value
    .replace(/\[unclear\]/gi, "")
    .replace(/\s*\((?:father|mother|parent|daughter|son|wife|husband|brother|sister|child|spouse|sibling|sister-in-law|brother-in-law)\)/gi, "")
    .replace(/^(?:mr|dr|miss|ms|rev)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.includes(":") || /^&/.test(name) || /unclear|connected to/i.test(name) || name.length < 2 || looksLikeDate(name)) return "";
  if (/^(?:father|mother|sister|brother|uncle|aunt|other|family|brothers|sisters|parents|child|children|husband|wife|son|daughter|spouse|relative)$/i.test(name)) return "";
  return name.slice(0, 80);
}

function looksLikeDate(name: string): boolean {
  return /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,4})?$/i.test(name) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(name) || /^(?:about|abt|circa|c)\.?\s+\d{3,4}$/i.test(name);
}

async function extractNotes(batch: Array<{ filename: string; text: string }>): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "Extract family facts from these transcriptions. For each page, start a section with ### and the filename. Under it, write one bullet per fact in this exact order: name, role, other person, date, place. The role must be one of daughter, son, father, mother, wife, husband, brother, sister. Example: - Nancy Husfeld, daughter, Norman Husfeld, 1968, Douglass. Do not write the words connected to. Do not put a role in parentheses. Do not use Uncle, Aunt, Friend, or Other as a name. Keep [unclear] when a name is missing. Skip a page when it has no people. Do not connect people across different pages. Do not invent a relationship the page does not state.",
        },
        {
          role: "user",
          content: batch.map((page) => `### ${page.filename}\n${page.text.slice(0, 4500)}`).join("\n\n"),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed. ${(await response.text()).slice(0, 180)}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("GPT returned no answer.");
  return answer;
}

function sectionFor(extracted: string, filename: string): string {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`###\\s+${escaped}\\s*`, "i").exec(extracted);
  if (!match) return "";
  const rest = extracted.slice(match.index + match[0].length);
  const next = rest.search(/\n###\s+\S+/);
  return (next === -1 ? rest : rest.slice(0, next)).trim().slice(0, 1200);
}

function pack<T extends { text: string; filename: string }>(pages: T[], budget: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const page of pages) {
    const length = Math.min(page.text.length, 4500) + page.filename.length;
    if (current.length > 0 && size + length > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(page);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function note(draft: FamilyDraft, message: string): void {
  draft.updatedAt = new Date().toISOString();
  draft.log = [...draft.log, { at: draft.updatedAt, message }].slice(-40);
}

const FAMILY_PAGE = /family|husband|wife|father|mother|\bchild|born|birth|married|marriage|daughter|\bson\b|buried|death|parent|spouse|genealog/i;

async function loadFamilyPages(): Promise<Array<{ filename: string; text: string }>> {
  const credentials = upstashVectorCredentials();
  if (!credentials) throw new Error("Upstash Vector is not configured.");
  const pages: Array<{ filename: string; text: string }> = [];
  let cursor = "0";
  const seen = new Set<string>();
  for (let page = 0; page < 30 && !seen.has(cursor); page += 1) {
    seen.add(cursor);
    const response = await fetch(`${credentials.url}/range`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cursor, limit: 100, includeMetadata: true, includeVectors: false }),
    });
    if (!response.ok) break;
    const payload = (await response.json()) as { result?: { nextCursor?: string; vectors?: unknown[] } };
    const vectors = payload.result?.vectors ?? [];
    for (const row of vectors) {
      const vector = row as { id?: string; metadata?: Record<string, unknown> };
      const text = vectorText(vector.metadata, "description");
      const filename = vectorText(vector.metadata, "filename") || vector.id || "";
      if (!text || !filename || !FAMILY_PAGE.test(text)) continue;
      const current = pages.find((item) => item.filename === filename);
      if (!current) pages.push({ filename, text });
      else if (text.length > current.text.length) current.text = text;
    }
    const next = payload.result?.nextCursor;
    if (!next || vectors.length === 0) break;
    cursor = String(next);
  }
  return pages;
}

function vectorText(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

async function readNotes(): Promise<NoteCache> {
  try {
    return JSON.parse(await readFile(NOTES, "utf8")) as NoteCache;
  } catch {
    return {};
  }
}

async function loadDraft(): Promise<FamilyDraft> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<FamilyDraft>;
    const base = emptyDraft();
    return {
      ...base,
      ...parsed,
      people: Array.isArray(parsed.people) ? parsed.people.flatMap(cleanDraftPerson) : [],
      log: Array.isArray(parsed.log) ? parsed.log.filter((item) => item && typeof item.message === "string").slice(-40) : [],
    };
  } catch {
    return emptyDraft();
  }
}

function cleanDraftPerson(value: unknown): DraftPerson[] {
  const person = value as Partial<DraftPerson>;
  if (typeof person.name !== "string" || !person.name.trim()) return [];
  return [
    {
      id: typeof person.id === "string" ? person.id : randomUUID(),
      name: person.name.trim().slice(0, 80),
      role: person.role === "daughter" || person.role === "son" ? person.role : "",
      parentNames: names(person.parentNames),
      siblingNames: names(person.siblingNames),
      wifeName: typeof person.wifeName === "string" ? person.wifeName.trim().slice(0, 80) : "",
      born: text(person.born),
      died: text(person.died),
      birthplace: text(person.birthplace),
      home: text(person.home),
      school: text(person.school),
      work: text(person.work),
      sources: names(person.sources).slice(0, 12),
    },
  ];
}

function linkName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

function cleanBorn(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function uniqueNames(value: unknown): string[] {
  const names: string[] = [];
  if (!Array.isArray(value)) return names;
  for (const item of value) {
    const name = linkName(item);
    if (!name || names.some((existing) => sameName(existing, name))) continue;
    names.push(name);
  }
  return names;
}

function linkChildren(value: unknown): Array<{ name: string; role: "daughter" | "son" }> {
  if (!Array.isArray(value)) return [];
  const children: Array<{ name: string; role: "daughter" | "son" }> = [];
  for (const item of value) {
    const record = item as { name?: unknown; role?: unknown };
    const name = linkName(record?.name);
    if (!name || (record.role !== "daughter" && record.role !== "son")) throw new Error(`Choose daughter or son for ${name || "each child"}.`);
    if (children.some((child) => sameName(child.name, name))) continue;
    children.push({ name, role: record.role });
  }
  return children;
}

function rewriteDraftNames(draft: FamilyDraft, from: string, to: string) {
  for (const person of draft.people) {
    if (sameName(person.name, from)) person.name = to;
    person.parentNames = person.parentNames.map((name) => (sameName(name, from) ? to : name));
    person.siblingNames = person.siblingNames.map((name) => (sameName(name, from) ? to : name));
    if (sameName(person.wifeName, from)) person.wifeName = to;
  }
}

function mergeDraftPerson(kept: DraftPerson, other: DraftPerson) {
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
  for (const source of other.sources) {
    if (kept.sources.length >= 12 || kept.sources.includes(source)) continue;
    kept.sources.push(source);
  }
}

function stripDraftSelf(person: DraftPerson) {
  person.parentNames = person.parentNames.filter((name, index, list) => !sameName(name, person.name) && list.findIndex((item) => sameName(item, name)) === index).slice(0, 4);
  if (person.parentNames.length === 0) person.role = "";
  if (sameName(person.wifeName, person.name) || person.parentNames.some((name) => sameName(name, person.wifeName))) person.wifeName = "";
  person.siblingNames = person.siblingNames
    .filter((name, index, list) => !sameName(name, person.name) && !sameName(name, person.wifeName) && !person.parentNames.some((parent) => sameName(parent, name)) && list.findIndex((item) => sameName(item, name)) === index)
    .slice(0, 8);
}

function ensureDraftPerson(draft: FamilyDraft, name: string): DraftPerson {
  const found = draft.people.find((person) => sameName(person.name, name));
  if (found) return found;
  const person: DraftPerson = {
    id: randomUUID(),
    name,
    role: "",
    parentNames: [],
    siblingNames: [],
    wifeName: "",
    born: "",
    died: "",
    birthplace: "",
    home: "",
    school: "",
    work: "",
    sources: [],
  };
  draft.people.push(person);
  return person;
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function emptyDraft(): FamilyDraft {
  return {
    state: "idle",
    phase: "No scan yet.",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    pagesSeen: 0,
    familyPages: 0,
    pagesRead: 0,
    people: [],
    log: [],
    error: null,
    appliedAt: null,
    added: 0,
    updated: 0,
  };
}

async function writeDraft(draft: FamilyDraft): Promise<void> {
  draft.updatedAt = new Date().toISOString();
  const temp = `${FILE}.tmp`;
  await writeFile(temp, JSON.stringify(draft, null, 2));
  await rename(temp, FILE);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
