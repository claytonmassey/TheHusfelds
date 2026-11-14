import { normalizeName, sameName, type Person } from "@/lib/photo-types";

export type FamilyNode = {
  id: string;
  name: string;
  x: number;
  y: number;
};

export type FamilyEdge = {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type FamilySlot = {
  id: string;
  kind: "parent" | "wife" | "child";
  label: string;
  personId: string;
  anchorName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FamilyLayout = {
  nodes: FamilyNode[];
  edges: FamilyEdge[];
  slots: FamilySlot[];
  width: number;
  height: number;
  unlinkedLabel: { x: number; y: number } | null;
};

const NODE_W = 196;
const NODE_H = 68;
const GAP_X = 112;
const GAP_Y = 116;
const FAMILY_GAP = 80;
const PAD = 28;
const SLOT_W = 92;
const SLOT_H = 36;
const SLOT_GAP = 14;

export function layoutFamily(people: Person[]): FamilyLayout {
  const byName = new Map(people.map((person) => [normalizeName(person.name), person]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();

  for (const person of people) {
    if (!person.role || person.parentNames.length === 0) continue;
    const parentIds = person.parentNames.flatMap((name) => {
      const parent = byName.get(normalizeName(name));
      return parent && parent.id !== person.id ? [parent.id] : [];
    });
    if (parentIds.length === 0) continue;
    parentsOf.set(person.id, parentIds);
    for (const parentId of parentIds) {
      childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), person.id]);
    }
  }

  const byId = new Map(people.map((person) => [person.id, person]));
  const involved = new Set<string>([...parentsOf.keys(), ...childrenOf.keys()]);
  for (const id of [...involved]) {
    const partner = partnerOf(id, byId, byName, people);
    if (partner) involved.add(partner);
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const id of involved) {
    const partner = partnerOf(id, byId, byName, people);
    if (partner && involved.has(partner)) unite(id, partner);
  }
  for (const parentIds of parentsOf.values()) {
    for (const parentId of parentIds.slice(1)) unite(parentIds[0], parentId);
  }
  const households = new Map<string, string[]>();
  for (const id of involved) {
    const house = find(id);
    households.set(house, [...(households.get(house) ?? []), id]);
  }
  const ordered = (ids: string[]) => {
    const sorted = [...ids].sort((left, right) => nameOf(people, left).localeCompare(nameOf(people, right)));
    const seated: string[] = [];
    const used = new Set<string>();
    for (const id of sorted) {
      if (used.has(id)) continue;
      seated.push(id);
      used.add(id);
      const partner = partnerOf(id, byId, byName, people);
      if (partner && ids.includes(partner) && !used.has(partner)) {
        seated.push(partner);
        used.add(partner);
      }
    }
    return seated;
  };
  for (const [house, ids] of households) households.set(house, ordered(ids));
  const childHouses = new Map<string, string[]>();
  for (const [house, ids] of households) {
    const kids = new Set<string>();
    for (const id of ids) {
      for (const child of childrenOf.get(id) ?? []) {
        const childHouse = find(child);
        if (childHouse !== house) kids.add(childHouse);
      }
    }
    childHouses.set(
      house,
      [...kids].sort((left, right) => nameOf(people, households.get(left)?.[0] ?? left).localeCompare(nameOf(people, households.get(right)?.[0] ?? right))),
    );
  }
  const childOf = new Set<string>([...childHouses.values()].flat());
  const roots = [...households.keys()].filter((house) => !childOf.has(house)).sort((left, right) => nameOf(people, households.get(left)?.[0] ?? left).localeCompare(nameOf(people, households.get(right)?.[0] ?? right)));
  const widthOf = new Map<string, number>();
  const measure = (house: string, seen: Set<string>): number => {
    const known = widthOf.get(house);
    if (known != null) return known;
    const ids = households.get(house) ?? [];
    const self = ids.length * NODE_W + Math.max(0, ids.length - 1) * COUPLE_GAP;
    if (seen.has(house)) return self;
    seen.add(house);
    const kids = (childHouses.get(house) ?? []).filter((kid) => !seen.has(kid));
    const kidsWidth = kids.reduce((sum, kid, index) => sum + measure(kid, seen) + (index > 0 ? FAMILY_GAP : 0), 0);
    seen.delete(house);
    const width = Math.max(self, kidsWidth);
    widthOf.set(house, width);
    return width;
  };
  const positions = new Map<string, { x: number; y: number }>();
  const placeHouse = (house: string, left: number, depth: number, seen: Set<string>) => {
    if (seen.has(house)) return;
    seen.add(house);
    const width = measure(house, new Set());
    const ids = households.get(house) ?? [];
    const self = ids.length * NODE_W + Math.max(0, ids.length - 1) * COUPLE_GAP;
    let x = left + (width - self) / 2;
    const y = PAD + depth * (NODE_H + GAP_Y);
    for (const id of ids) {
      positions.set(id, { x, y });
      x += NODE_W + COUPLE_GAP;
    }
    const kids = (childHouses.get(house) ?? []).filter((kid) => !seen.has(kid));
    const kidsWidth = kids.reduce((sum, kid, index) => sum + measure(kid, new Set()) + (index > 0 ? FAMILY_GAP : 0), 0);
    let childX = left + (width - kidsWidth) / 2;
    for (const kid of kids) {
      placeHouse(kid, childX, depth + 1, seen);
      childX += measure(kid, new Set()) + FAMILY_GAP;
    }
  };
  let cursor = PAD;
  const placed = new Set<string>();
  for (const house of roots) {
    placeHouse(house, cursor, 0, placed);
    cursor += measure(house, new Set()) + FAMILY_GAP;
  }
  const linkedBottom = Math.max(PAD, ...[...positions.values()].map((position) => position.y + NODE_H));
  const unlinked = people.filter((person) => !positions.has(person.id)).sort((left, right) => left.name.localeCompare(right.name));
  seatList(unlinked, byName);
  const treeWidth = Math.max(cursor, PAD * 2);
  const unlinkedY = positions.size > 0 ? linkedBottom + 40 : PAD;
  placeRow(
    unlinked.map((person) => person.id),
    unlinkedY,
    treeWidth,
    positions,
    people,
  );

  const slots = slotsFor(people, positions);
  const unlinkedLabel = positions.size > unlinked.length && unlinked.length > 0 ? { x: PAD, y: unlinkedY - 22 } : null;
  const bounds = boundsOf(positions, slots, treeWidth, unlinked.length > 0 ? unlinkedY + NODE_H : linkedBottom);
  shiftLayout(positions, slots, unlinkedLabel, bounds.dx, bounds.dy);

  const nodes = people.flatMap((person) => {
    const position = positions.get(person.id);
    if (!position) return [];
    return [{ id: person.id, name: person.name, x: position.x, y: position.y }];
  });

  const edges: FamilyEdge[] = [];
  for (const [childId, parentIds] of parentsOf) {
    const child = positions.get(childId);
    if (!child) continue;
    for (const parentId of parentIds) {
      const parent = positions.get(parentId);
      if (!parent) continue;
      edges.push({
        fromId: parentId,
        toId: childId,
        x1: parent.x + NODE_W / 2,
        y1: parent.y + NODE_H,
        x2: child.x + NODE_W / 2,
        y2: child.y,
      });
    }
  }

  return {
    nodes,
    edges,
    slots,
    width: bounds.width,
    height: bounds.height,
    unlinkedLabel,
  };
}

export const FAMILY_NODE_SIZE = { width: NODE_W, height: NODE_H };

const FOCUS_GAP_X = 36;
const FOCUS_GAP_Y = 92;

export function directFamily(people: Person[], focusId: string): Set<string> {
  const person = people.find((item) => item.id === focusId);
  const members = new Set<string>([focusId]);
  if (!person) return members;
  for (const other of people) {
    if (other.id === person.id) continue;
    if (person.parentNames.some((name) => sameName(name, other.name))) members.add(other.id);
    if (other.role && other.parentNames.some((name) => sameName(name, person.name))) members.add(other.id);
    if (sameName(other.name, person.wifeName) || sameName(other.wifeName, person.name)) members.add(other.id);
  }
  return members;
}

export function personalShifts(
  people: Person[],
  nodes: FamilyNode[],
  focusId: string,
): Record<string, { x: number; y: number }> {
  const focus = nodes.find((node) => node.id === focusId);
  const person = people.find((item) => item.id === focusId);
  if (!focus || !person) return {};
  const parents = people.filter((other) => person.parentNames.some((name) => sameName(name, other.name)));
  const children = people
    .filter((other) => other.role && other.parentNames.some((name) => sameName(name, person.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
  const partner = people.find((other) => other.id !== person.id && (sameName(other.name, person.wifeName) || sameName(other.wifeName, person.name)));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const shifts: Record<string, { x: number; y: number }> = {};
  const place = (id: string, x: number, y: number) => {
    const node = byId.get(id);
    if (!node) return;
    const dx = x - node.x;
    const dy = y - node.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) shifts[id] = { x: dx, y: dy };
  };
  const placeRow = (row: Person[], midX: number, y: number) => {
    const width = row.length * NODE_W + Math.max(0, row.length - 1) * FOCUS_GAP_X;
    const start = midX - width / 2;
    row.forEach((item, index) => place(item.id, start + index * (NODE_W + FOCUS_GAP_X), y));
  };
  place(person.id, focus.x, focus.y);
  if (partner) place(partner.id, focus.x + NODE_W + FOCUS_GAP_X, focus.y);
  const mid = partner ? focus.x + NODE_W + FOCUS_GAP_X / 2 : focus.x + NODE_W / 2;
  placeRow(parents, mid, focus.y - NODE_H - FOCUS_GAP_Y);
  placeRow(children, mid, focus.y + NODE_H + FOCUS_GAP_Y);

  const targets = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const shift = shifts[node.id];
    targets.set(node.id, shift ? { x: node.x + shift.x, y: node.y + shift.y } : { x: node.x, y: node.y });
  }
  const members = new Set<string>([person.id, ...parents.map((item) => item.id), ...children.map((item) => item.id)]);
  if (partner) members.add(partner.id);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const id of members) {
    const spot = targets.get(id);
    if (!spot) continue;
    left = Math.min(left, spot.x);
    top = Math.min(top, spot.y);
    right = Math.max(right, spot.x + NODE_W);
    bottom = Math.max(bottom, spot.y + NODE_H);
  }
  const pad = 28;
  for (const node of nodes) {
    if (members.has(node.id)) continue;
    const spot = targets.get(node.id);
    if (!spot) continue;
    const overlaps = spot.x < right + pad && spot.x + NODE_W > left - pad && spot.y < bottom + pad && spot.y + NODE_H > top - pad;
    if (!overlaps) continue;
    const centerX = spot.x + NODE_W / 2;
    const centerY = spot.y + NODE_H / 2;
    const boxMidX = (left + right) / 2;
    const boxMidY = (top + bottom) / 2;
    const pastX = centerX < boxMidX ? left - pad - NODE_W - spot.x : right + pad - spot.x;
    const pastY = centerY < boxMidY ? top - pad - NODE_H - spot.y : bottom + pad - spot.y;
    const dx = Math.abs(pastX) < Math.abs(pastY) ? pastX : 0;
    const dy = Math.abs(pastY) <= Math.abs(pastX) ? pastY : 0;
    place(node.id, spot.x + dx, spot.y + dy);
  }
  return shifts;
}

const COUPLE_GAP = 28;

function partnerOf(id: string, byId: Map<string, Person>, byName: Map<string, Person>, people: Person[]): string | undefined {
  const person = byId.get(id);
  if (!person) return;
  const named = spouseOf(person, byName);
  if (named) return named.id;
  return people.find((other) => other.id !== id && sameName(other.wifeName, person.name))?.id;
}

function seatList(list: Person[], byName: Map<string, Person>) {
  for (const person of [...list]) {
    const wife = spouseOf(person, byName);
    if (!wife) continue;
    const from = list.findIndex((item) => item.id === wife.id);
    if (from < 0) continue;
    list.splice(from, 1);
    const home = list.findIndex((item) => item.id === person.id);
    if (home < 0) continue;
    list.splice(home + 1, 0, wife);
  }
}

function spouseOf(person: Person, byName: Map<string, Person>): Person | undefined {
  const wifeName = person.wifeName?.trim();
  if (!wifeName) return undefined;
  const wife = byName.get(normalizeName(wifeName));
  return wife && wife.id !== person.id ? wife : undefined;
}

function placeRow(ids: string[], y: number, width: number, positions: Map<string, { x: number; y: number }>, people: Person[]) {
  if (ids.length === 0) return;
  const byId = new Map(people.map((person) => [person.id, person]));
  const gaps = ids.slice(1).map((id, index) => (couple(byId.get(ids[index]), byId.get(id)) ? COUPLE_GAP : GAP_X));
  const rowWidth = ids.length * NODE_W + gaps.reduce((sum, gap) => sum + gap, 0);
  let x = (width - rowWidth) / 2;
  ids.forEach((id, index) => {
    positions.set(id, { x, y });
    x += NODE_W + (gaps[index] ?? 0);
  });
}

function couple(left: Person | undefined, right: Person | undefined): boolean {
  if (!left || !right) return false;
  return sameName(left.wifeName, right.name) || sameName(right.wifeName, left.name);
}

function nameOf(people: Person[], id: string): string {
  return people.find((person) => person.id === id)?.name ?? id;
}

function wantsWife(person: Person, people: Person[]): boolean {
  if (person.wifeName.trim()) return false;
  return !people.some((other) => other.id !== person.id && sameName(other.wifeName, person.name));
}

function slotsFor(people: Person[], positions: Map<string, { x: number; y: number }>): FamilySlot[] {
  const slots: FamilySlot[] = [];
  for (const person of people) {
    const position = positions.get(person.id);
    if (!position) continue;
    const belowY = position.y + NODE_H + SLOT_GAP;
    const aboveY = position.y - SLOT_H - 46;
    const midX = position.x + (NODE_W - SLOT_W) / 2;
    if (person.parentNames.length === 0) slots.push(makeSlot("parent", "Parent", person, midX, aboveY));
    if (wantsWife(person, people)) {
      slots.push(makeSlot("wife", "Spouse", person, position.x + NODE_W + SLOT_GAP, position.y + (NODE_H - SLOT_H) / 2));
    }
    slots.push(makeSlot("child", "Child", person, midX, belowY));
  }
  return slots;
}

function makeSlot(kind: FamilySlot["kind"], label: string, person: Person, x: number, y: number): FamilySlot {
  return {
    id: `${kind}:${person.id}`,
    kind,
    label,
    personId: person.id,
    anchorName: person.name,
    x,
    y,
    width: SLOT_W,
    height: SLOT_H,
  };
}

function boundsOf(
  positions: Map<string, { x: number; y: number }>,
  slots: FamilySlot[],
  width: number,
  contentBottom: number,
): { dx: number; dy: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = contentBottom;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + NODE_W);
    maxY = Math.max(maxY, position.y + NODE_H);
  }
  for (const slot of slots) {
    minX = Math.min(minX, slot.x);
    minY = Math.min(minY, slot.y);
    maxX = Math.max(maxX, slot.x + slot.width);
    maxY = Math.max(maxY, slot.y + slot.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { dx: 0, dy: 0, width, height: contentBottom + PAD };
  const dx = minX < PAD ? PAD - minX : 0;
  const dy = minY < PAD ? PAD - minY : 0;
  return { dx, dy, width: Math.max(width, maxX + dx + PAD), height: maxY + dy + PAD };
}

function shiftLayout(
  positions: Map<string, { x: number; y: number }>,
  slots: FamilySlot[],
  unlinkedLabel: { x: number; y: number } | null,
  dx: number,
  dy: number,
) {
  if (!dx && !dy) return;
  for (const position of positions.values()) {
    position.x += dx;
    position.y += dy;
  }
  for (const slot of slots) {
    slot.x += dx;
    slot.y += dy;
  }
  if (unlinkedLabel) {
    unlinkedLabel.x += dx;
    unlinkedLabel.y += dy;
  }
}
