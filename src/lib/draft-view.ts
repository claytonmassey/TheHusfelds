import { normalizeName, sameName } from "@/lib/photo-types";

export type SourcePerson = {
  name: string;
  role: "" | "daughter" | "son";
  parentNames: string[];
  siblingNames?: string[];
  wifeName?: string;
  born?: string;
  where?: "family" | "draft";
  draftId?: string;
  liveId?: string;
};

export type DraftRow = {
  key: string;
  name: string;
  role: "" | "daughter" | "son";
  parentNames: string[];
  siblingNames: string[];
  wifeName: string;
  born: string;
  where: "family" | "draft" | "both";
  draftId?: string;
  liveId?: string;
};

export type FamilyCard = {
  id: string;
  parents: string[];
  children: Array<{ key: string; name: string; role: string; born: string }>;
  sortDate: string;
};

export function draftRows(people: SourcePerson[]): DraftRow[] {
  const labeled = people
    .map((person) => ({ ...person, name: showName(person.name) }))
    .filter((person) => isLabel(person.name) && !isTitleName(person.name));
  const sorted = [...labeled].sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));
  const rows: DraftRow[] = [];
  for (const person of sorted) {
    const hosts = rows.filter((row) => aliases(row.name, person.name));
    if (hosts.length !== 1) {
      rows.push(toRow(person));
      continue;
    }
    const host = hosts[0];
    const better = betterName(host.name, person.name);
    if (better !== host.name) {
      host.name = better;
      host.key = normalizeName(better);
      if (person.draftId) host.draftId = person.draftId;
      if (person.liveId) host.liveId = person.liveId;
    }
    absorb(host, person);
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function familyCards(rows: DraftRow[]): FamilyCard[] {
  const groups = new Map<string, { parents: string[]; children: DraftRow[] }>();
  for (const row of rows) {
    const parents = tightenParents(unique(row.parentNames.map((name) => canonicalParent(name, rows)).filter(Boolean)));
    if (parents.length === 0) continue;
    const id = parents.map((name) => normalizeName(name)).sort().join("|");
    const group = groups.get(id) ?? { parents, children: [] };
    group.children.push(row);
    groups.set(id, group);
  }
  const built = mergeRelatedGroups([...groups.values()]).map((group) => {
    const parents = displayParents(group.parents);
    const children = collapseChildren(group.children).sort(byBornThenName);
    const sortDate = earliest([
      ...parents.map((name) => rows.find((row) => sameName(row.name, name))?.born ?? ""),
      ...children.map((child) => child.born),
    ]);
    return {
      id: parents.map((name) => normalizeName(name)).sort().join("|"),
      parents,
      children: children.map((child) => ({ key: child.key, name: child.name, role: child.role, born: child.born })),
      sortDate,
    };
  });
  return orderHouseholds(built);
}

export function childRows(person: DraftRow, rows: DraftRow[]): DraftRow[] {
  return rows
    .filter((row) => row.key !== person.key && row.parentNames.some((name) => sameName(canonicalParent(name, rows), person.name)))
    .sort(byBornThenName);
}

export function formatBorn(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toRow(person: SourcePerson): DraftRow {
  return {
    key: normalizeName(person.name),
    name: person.name,
    role: person.role,
    parentNames: person.parentNames.map(showName).filter(isLabel),
    siblingNames: (person.siblingNames ?? []).map(showName).filter(isLabel),
    wifeName: person.wifeName ? showName(person.wifeName) : "",
    born: person.born ?? "",
    where: person.where ?? "draft",
    draftId: person.draftId,
    liveId: person.liveId,
  };
}

function absorb(row: DraftRow, person: SourcePerson) {
  const parents = person.parentNames.map(showName).filter(isLabel);
  if (namedParents(parents).length > namedParents(row.parentNames).length) row.parentNames = parents;
  if (!row.role && person.role) row.role = person.role;
  if (!row.wifeName && person.wifeName) row.wifeName = showName(person.wifeName);
  if (!row.born && person.born) row.born = person.born;
  if (row.siblingNames.length === 0 && person.siblingNames?.length) row.siblingNames = person.siblingNames.map(showName).filter(isLabel);
  if (person.draftId && !row.draftId) row.draftId = person.draftId;
  if (person.liveId) row.liveId = person.liveId;
  if ((person.where === "family" && row.draftId) || (person.where === "draft" && row.liveId) || (row.where === "family" && person.draftId)) row.where = "both";
  else if (person.where === "family") row.where = "family";
}

function namedParents(parents: string[]): string[] {
  return parents.filter((name) => !isTitleName(name));
}

function betterName(current: string, incoming: string): string {
  const bad = /hustled|husfeldt|huusfeld/i;
  if (bad.test(current) && !bad.test(incoming)) return incoming;
  if (bad.test(incoming) && !bad.test(current)) return current;
  return incoming.length > current.length ? incoming : current;
}

function canonicalParent(name: string, rows: DraftRow[]): string {
  const clean = showName(name);
  if (!clean || !isLabel(clean)) return "";
  if (isTitleName(clean)) return clean;
  const hosts = rows.filter((row) => aliases(row.name, clean));
  if (hosts.length === 1) return hosts[0].name;
  return clean;
}

function tightenParents(parents: string[]): string[] {
  const uniqueParents = unique(parents);
  return uniqueParents.filter((name, index) => !uniqueParents.some((other, otherIndex) => index !== otherIndex && aliases(name, other) && name.length < other.length));
}

function mergeRelatedGroups(groups: { parents: string[]; children: DraftRow[] }[]): { parents: string[]; children: DraftRow[] }[] {
  const pending = groups.map((group) => ({ parents: [...group.parents], children: [...group.children] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let left = 0; left < pending.length; left += 1) {
      for (let right = left + 1; right < pending.length; right += 1) {
        if (!sameHousehold(pending[left].parents, pending[right].parents)) continue;
        pending[left] = {
          parents: displayParents([...pending[left].parents, ...pending[right].parents]),
          children: [...pending[left].children, ...pending[right].children],
        };
        pending.splice(right, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return pending;
}

function sameHousehold(left: string[], right: string[]): boolean {
  const shared = left.filter((name) => right.some((other) => sameName(name, other) || aliases(name, other)));
  if (shared.length === 0) {
    const titleSide = (titles: string[], household: string[]) =>
      titles.length > 0 &&
      titles.every((name) => household.some((person) => isTitleOf(name, person))) &&
      household.some((person) => !titles.some((name) => isTitleOf(name, person)));
    return titleSide(left, right) || titleSide(right, left);
  }
  const extras = (names: string[]) => names.filter((name) => !shared.some((common) => sameName(name, common) || aliases(name, common)));
  const leftExtra = extras(left);
  const rightExtra = extras(right);
  const titleOnly = (names: string[]) => names.length > 0 && names.every((name) => shared.some((person) => isTitleOf(name, person)));
  if (leftExtra.length === 0 && rightExtra.length === 0) return true;
  if (titleOnly(leftExtra) && rightExtra.length === 1 && !isTitleName(rightExtra[0])) return true;
  if (titleOnly(rightExtra) && leftExtra.length === 1 && !isTitleName(leftExtra[0])) return true;
  if (leftExtra.length === 0 || rightExtra.length === 0) return false;
  return leftExtra.every((name) => rightExtra.some((other) => aliases(name, other))) && rightExtra.every((name) => leftExtra.some((other) => aliases(name, other)));
}

function displayParents(parents: string[]): string[] {
  const tightened = tightenParents(parents);
  return tightened.filter((name) => {
    const named = tightened.find((other) => isTitleOf(name, other));
    if (!named) return true;
    return !tightened.some((other) => other !== named && !isTitleOf(other, named));
  });
}

function collapseChildren(children: DraftRow[]): DraftRow[] {
  const kept: DraftRow[] = [];
  for (const child of children) {
    const match = kept.find((other) => aliases(other.name, child.name));
    if (!match) {
      kept.push(child);
      continue;
    }
    if (betterName(match.name, child.name) === child.name) kept[kept.indexOf(match)] = child;
  }
  return kept;
}

function orderHouseholds(cards: FamilyCard[]): FamilyCard[] {
  const headedBy = new Map<string, FamilyCard[]>();
  const listedOn = new Map<string, FamilyCard[]>();
  for (const card of cards) {
    for (const parent of card.parents) pushCard(headedBy, normalizeName(parent), card);
    for (const child of card.children) pushCard(listedOn, normalizeName(child.name), card);
  }

  const heads = (name: string) => headedBy.get(normalizeName(name)) ?? [];
  const listings = (name: string) => listedOn.get(normalizeName(name)) ?? [];

  const seen = new Set<string>();
  const ordered: FamilyCard[] = [];
  const visit = (card: FamilyCard) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    ordered.push(card);
    for (const child of card.children) {
      const nextCards = [...heads(child.name)].sort(
        (left, right) => compareDated(left.sortDate, right.sortDate) || left.parents.join(" ").localeCompare(right.parents.join(" ")),
      );
      for (const next of nextCards) visit(next);
    }
  };

  const roots = cards.filter((card) => !card.parents.some((parent) => listings(parent).some((other) => other.id !== card.id)));
  roots.sort((left, right) => compareDated(lineageDate(left, heads, new Set()), lineageDate(right, heads, new Set())) || left.parents.join(" ").localeCompare(right.parents.join(" ")));
  for (const root of roots) visit(root);
  for (const card of cards) visit(card);
  return ordered;
}

function pushCard(index: Map<string, FamilyCard[]>, key: string, card: FamilyCard) {
  if (!key) return;
  const list = index.get(key);
  if (list) {
    if (!list.some((item) => item.id === card.id)) list.push(card);
    return;
  }
  index.set(key, [card]);
}

function lineageDate(card: FamilyCard, heads: (name: string) => FamilyCard[], visiting: Set<string>): string {
  if (visiting.has(card.id)) return "";
  visiting.add(card.id);
  const dates = [card.sortDate];
  for (const child of card.children) {
    for (const next of heads(child.name)) dates.push(lineageDate(next, heads, visiting));
  }
  visiting.delete(card.id);
  return earliest(dates);
}

function compareDated(left: string, right: string): number {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function byBornThenName(left: { born: string; name: string }, right: { born: string; name: string }): number {
  if (left.born && right.born) return left.born.localeCompare(right.born) || left.name.localeCompare(right.name);
  if (left.born) return -1;
  if (right.born) return 1;
  return left.name.localeCompare(right.name);
}

function earliest(values: string[]): string {
  return values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort()[0] ?? "";
}

function unique(names: string[]): string[] {
  const kept: string[] = [];
  for (const name of names) {
    if (!kept.some((item) => sameName(item, name))) kept.push(name);
  }
  return kept;
}

export function aliases(left: string, right: string): boolean {
  if (isTitleOf(left, right) || isTitleOf(right, left)) return false;
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  if (leftTokens.join(" ") === rightTokens.join(" ")) return true;
  const smallFirst = leftTokens.length <= rightTokens.length;
  const small = smallFirst ? leftTokens : rightTokens;
  const big = smallFirst ? rightTokens : leftTokens;
  const bigName = smallFirst ? right : left;
  if (!small.every((token) => big.includes(token))) return false;
  if (small.length > 1 && !small.includes(big[big.length - 1])) return false;
  if (small.length === 1) return small[0] === big[0] || nicknames(bigName).includes(small[0]);
  const extra = big.filter((token) => !small.includes(token));
  const nicks = nicknames(bigName);
  if (extra.length === 0) return true;
  if (extra.every((token) => nicks.includes(token))) return true;
  return small.some((token) => nicks.includes(token));
}

function nameTokens(name: string): string[] {
  return showName(name)
    .toLowerCase()
    .replace(/[“”"()]/g, " ")
    .replace(/\bhustled\b|\bhusfeldt\b|\bhuusfeldt\b|\bhuusfeld\b/g, "husfeld")
    .split(/\s+/)
    .filter((token) => token && !/^(?:mr|mrs|ms|and)$/.test(token));
}

function nicknames(name: string): string[] {
  return [...showName(name).toLowerCase().matchAll(/\(([^)]+)\)/g)].flatMap((match) => match[1].split(/\s+/)).filter((token) => token.length > 2);
}

function isTitleOf(name: string, person: string): boolean {
  const rest = showName(name).replace(/^and\s+/i, "").match(/^(?:mrs?|ms)\.?\s+(.+)$/i)?.[1];
  if (!rest) return false;
  const title = normalizeName(rest).replace(/\bhustled\b|\bhusfeldt\b|\bhuusfeldt\b|\bhuusfeld\b/g, "husfeld");
  const target = normalizeName(person).replace(/\bhustled\b|\bhusfeldt\b|\bhuusfeldt\b|\bhuusfeld\b/g, "husfeld");
  return title === target;
}

function isTitleName(name: string): boolean {
  const clean = showName(name);
  if (/\bmr\.?\s+and\s+mrs\.?\b/i.test(name) || /\bmr\.?\s+and\s+mrs\.?\b/i.test(clean)) return false;
  return /^(?:mrs?|ms)\.?\s+\S+/i.test(clean.replace(/^and\s+/i, ""));
}

function isLabel(name: string): boolean {
  const clean = showName(name);
  if (clean.length < 2 || clean.includes(":") || /^&/.test(clean) || /connected to|unclear/i.test(clean) || looksLikeDate(clean)) return false;
  return !/^(?:father|mother|sister|brother|uncle|aunt|other|family|brothers|sisters|parents|child|children|husband|wife|son|daughter|spouse|relative)$/i.test(clean);
}

function looksLikeDate(name: string): boolean {
  return /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,4})?$/i.test(name) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(name) || /^(?:about|abt|circa|c)\.?\s+\d{3,4}$/i.test(name);
}

function showName(value: string): string {
  return value
    .replace(/^connected to\s+/i, "")
    .replace(/\s*\((?:father|mother|parent|daughter|son|wife|husband|brother|sister|child|spouse|sibling|sister-in-law|brother-in-law)\)/gi, "")
    .replace(/^(?:mr|dr|miss|ms|rev)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
