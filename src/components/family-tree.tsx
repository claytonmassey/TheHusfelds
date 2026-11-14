"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import { AvatarCrop } from "@/components/avatar-crop";
import { NameSearch } from "@/components/name-search";
import { PersonProfile } from "@/components/person-profile";
import { directFamily, FAMILY_NODE_SIZE, layoutFamily, personalShifts, type FamilySlot } from "@/lib/family-layout";
import { mergeKnownNames, type KnownName } from "@/lib/known-name";
import { joinNames, sameName, type Person, type PersonAvatar } from "@/lib/photo-types";

export type FamilyPhoto = {
  sourcePath: string;
  filename: string;
  capturedAt: string | null;
  personIds: string[];
  rotation: number;
};

type FamilySeed = {
  kind: FamilySlot["kind"];
  anchorId: string;
};

type CardPull = { x: number; y: number };

function controlReach(slots: FamilySlot[], x: number, y: number) {
  const slop = 12;
  let above = 72;
  let below = slop;
  let side = 0;
  for (const slot of slots) {
    const relLeft = slot.x - x;
    const relTop = slot.y - y;
    above = Math.max(above, -relTop + slop);
    below = Math.max(below, relTop + slot.height - FAMILY_NODE_SIZE.height + slop);
    side = Math.max(side, relLeft + slot.width - FAMILY_NODE_SIZE.width + slop);
  }
  return { above, below, side: Math.min(Math.max(0, side), 108) };
}

export function FamilyTree({ people: initialPeople, photos, viewerId = null, names }: { people: Person[]; photos: FamilyPhoto[]; viewerId?: string | null; names: KnownName[] }) {
  const [people, setPeople] = useState(initialPeople);
  const layout = useMemo(() => layoutFamily(people), [people]);
  const options = useMemo(() => mergeKnownNames(names, people), [names, people]);
  const frameRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [seed, setSeed] = useState<FamilySeed | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [treeFocusId, setTreeFocusId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number }>>({});
  const motionRef = useRef<{ velX: number; velY: number; pointerX: number; pointerY: number; pulls: Map<string, CardPull>; raf: number }>({
    velX: 0,
    velY: 0,
    pointerX: 0,
    pointerY: 0,
    pulls: new Map(),
    raf: 0,
  });
  const nodesRef = useRef(layout.nodes);
  const scaleMotionRef = useRef(1);
  const flyRef = useRef(0);
  const flyToken = useRef(0);
  const placeRef = useRef(0);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const homeRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const treeFocusRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  const hoverSlideRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const slideRef = useRef<(id: string) => void>(() => {});
  selectedIdRef.current = selectedId;
  treeFocusRef.current = treeFocusId;
  creatingRef.current = creating;
  const [motionFrame, setMotionFrame] = useState(0);
  nodesRef.current = layout.nodes;
  scaleMotionRef.current = fit * zoom;
  const selected = people.find((person) => person.id === selectedId) ?? null;
  const spotlight = treeFocusId ?? hoveredId;
  const focused = useMemo(() => (spotlight ? directFamily(people, spotlight) : null), [spotlight, people]);
  const scale = fit * zoom;

  function applyZoom(nextZoom: number, pointerX: number, pointerY: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const clamped = Math.min(2.6, Math.max(0.7, nextZoom));
    const prevScale = fitRef.current * zoomRef.current;
    const nextScale = fitRef.current * clamped;
    const contentX = (pointerX - panRef.current.x) / prevScale;
    const contentY = (pointerY - panRef.current.y) / prevScale;
    const nextPan = { x: pointerX - contentX * nextScale, y: pointerY - contentY * nextScale };
    zoomRef.current = clamped;
    panRef.current = nextPan;
    setZoom(clamped);
    setPan(nextPan);
  }

  function zoomBy(factor: number) {
    const frame = frameRef.current;
    if (!frame) return;
    applyZoom(zoomRef.current * factor, frame.clientWidth / 2, frame.clientHeight / 2);
  }

  function fitTree() {
    const frame = frameRef.current;
    zoomRef.current = 1;
    setZoom(1);
    if (!frame) return;
    const next = {
      x: (frame.clientWidth - layout.width * fitRef.current) / 2,
      y: Math.max(28, (frame.clientHeight - layout.height * fitRef.current) / 2),
    };
    panRef.current = next;
    setPan(next);
  }

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const apply = () => {
      const nextFit = Math.min(1, Math.max(0.2, (frame.clientWidth - 16) / layout.width));
      const prevFit = fitRef.current;
      fitRef.current = nextFit;
      setFit(nextFit);
      if (zoomRef.current === 1) {
        const next = {
          x: (frame.clientWidth - layout.width * nextFit) / 2,
          y: Math.max(28, (frame.clientHeight - layout.height * nextFit) / 2),
        };
        panRef.current = next;
        setPan(next);
        return;
      }
      const cx = frame.clientWidth / 2;
      const cy = frame.clientHeight / 2;
      const contentX = (cx - panRef.current.x) / (prevFit * zoomRef.current);
      const contentY = (cy - panRef.current.y) / (prevFit * zoomRef.current);
      const nextScale = nextFit * zoomRef.current;
      const next = { x: cx - contentX * nextScale, y: cy - contentY * nextScale };
      panRef.current = next;
      setPan(next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [layout.width, layout.height]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      flyToken.current += 1;
      cancelAnimationFrame(flyRef.current);
      if (!selectedIdRef.current) {
        homeRef.current = null;
        settleRef.current();
      }
      const rect = frame.getBoundingClientRect();
      applyZoom(zoomRef.current * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX - rect.left, event.clientY - rect.top);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  function cancelFly() {
    flyToken.current += 1;
    cancelAnimationFrame(flyRef.current);
    flyRef.current = 0;
  }

  function glidePlaces(target: Record<string, { x: number; y: number }>) {
    cancelAnimationFrame(placeRef.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      placedRef.current = target;
      setPlaced(target);
      return;
    }
    const start = { ...placedRef.current };
    const ids = new Set([...Object.keys(start), ...Object.keys(target)]);
    const begun = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begun) / 820);
      const ease = 1 - (1 - t) ** 3;
      const next: Record<string, { x: number; y: number }> = {};
      for (const id of ids) {
        const from = start[id] ?? { x: 0, y: 0 };
        const to = target[id] ?? { x: 0, y: 0 };
        const x = from.x + (to.x - from.x) * ease;
        const y = from.y + (to.y - from.y) * ease;
        if (Math.abs(x) > 0.4 || Math.abs(y) > 0.4) next[id] = { x, y };
      }
      placedRef.current = next;
      setPlaced(next);
      if (t < 1) placeRef.current = requestAnimationFrame(step);
      else placeRef.current = 0;
    };
    placeRef.current = requestAnimationFrame(step);
  }

  const settleRef = useRef<() => void>(() => {});
  settleRef.current = () => {
    setTreeFocusId(null);
    glidePlaces({});
  };

  function flyTo(targetZoom: number, targetPan: { x: number; y: number }, done?: () => void) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      cancelFly();
      zoomRef.current = targetZoom;
      panRef.current = targetPan;
      setZoom(targetZoom);
      setPan(targetPan);
      done?.();
      return;
    }
    const token = flyToken.current + 1;
    flyToken.current = token;
    cancelAnimationFrame(flyRef.current);
    const startZoom = zoomRef.current;
    const startPan = { ...panRef.current };
    const start = performance.now();
    const step = (now: number) => {
      if (flyToken.current !== token) return;
      const t = Math.min(1, (now - start) / 820);
      const ease = 1 - (1 - t) ** 3;
      const nextZoom = startZoom + (targetZoom - startZoom) * ease;
      const nextPan = {
        x: startPan.x + (targetPan.x - startPan.x) * ease,
        y: startPan.y + (targetPan.y - startPan.y) * ease,
      };
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
      if (t < 1) flyRef.current = requestAnimationFrame(step);
      else {
        flyRef.current = 0;
        done?.();
      }
    };
    flyRef.current = requestAnimationFrame(step);
  }

  function focusView(id: string, shifts: Record<string, { x: number; y: number }>) {
    const frame = frameRef.current;
    const node = layout.nodes.find((item) => item.id === id);
    if (!frame || !node) return null;
    const members = directFamily(people, id);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const item of layout.nodes) {
      if (!members.has(item.id)) continue;
      const shift = shifts[item.id] ?? { x: 0, y: 0 };
      left = Math.min(left, item.x + shift.x);
      top = Math.min(top, item.y + shift.y);
      right = Math.max(right, item.x + shift.x + FAMILY_NODE_SIZE.width);
      bottom = Math.max(bottom, item.y + shift.y + FAMILY_NODE_SIZE.height);
    }
    const boxW = Math.max(FAMILY_NODE_SIZE.width, right - left);
    const boxH = Math.max(FAMILY_NODE_SIZE.height, bottom - top);
    const pad = 72;
    const fitScale = Math.min(
      Math.max(160, frame.clientWidth - pad) / boxW,
      Math.max(160, frame.clientHeight - pad) / boxH,
    );
    const nextZoom = Math.min(4.2, Math.max(1.05, fitScale / Math.max(fitRef.current, 0.05)));
    const nextScale = fitRef.current * nextZoom;
    const personShift = shifts[id] ?? { x: 0, y: 0 };
    let panX = frame.clientWidth / 2 - (node.x + personShift.x + FAMILY_NODE_SIZE.width / 2) * nextScale;
    let panY = frame.clientHeight / 2 - (node.y + personShift.y + FAMILY_NODE_SIZE.height / 2) * nextScale;
    const boxLeft = panX + left * nextScale;
    const boxRight = panX + right * nextScale;
    const boxTop = panY + top * nextScale;
    const boxBottom = panY + bottom * nextScale;
    const margin = 28;
    if (boxLeft < margin) panX += margin - boxLeft;
    if (boxRight > frame.clientWidth - margin) panX -= boxRight - (frame.clientWidth - margin);
    if (boxTop < margin) panY += margin - boxTop;
    if (boxBottom > frame.clientHeight - margin) panY -= boxBottom - (frame.clientHeight - margin);
    return { zoom: nextZoom, pan: { x: panX, y: panY } };
  }

  function clearFamilySlide() {
    window.clearTimeout(hoverSlideRef.current);
    hoverSlideRef.current = 0;
  }

  function queueFamilySlide(id: string, x: number, y: number) {
    const moved = Math.hypot(x - pointerRef.current.x, y - pointerRef.current.y);
    pointerRef.current = { x, y };
    if (treeFocusRef.current && moved < 6) return;
    clearFamilySlide();
    hoverSlideRef.current = window.setTimeout(() => {
      hoverSlideRef.current = 0;
      slideRef.current(id);
    }, 1000);
  }

  function showTree(id: string, done?: () => void) {
    clearFamilySlide();
    treeFocusRef.current = id;
    if (!homeRef.current) homeRef.current = { zoom: zoomRef.current, pan: { ...panRef.current } };
    setCreating(false);
    setSeed(null);
    setTreeFocusId(id);
    const shifts = personalShifts(people, layout.nodes, id);
    glidePlaces(shifts);
    const view = focusView(id, shifts);
    if (!view) {
      done?.();
      return;
    }
    flyTo(view.zoom, view.pan, done);
  }

  slideRef.current = (id: string) => {
    if (selectedIdRef.current || creatingRef.current) return;
    if (treeFocusRef.current === id) return;
    showTree(id);
  };

  function focusPerson(id: string) {
    setSelectedId(null);
    showTree(id);
  }

  function openPerson(id: string) {
    setSelectedId(null);
    showTree(id, () => setSelectedId(id));
  }

  function returnHome() {
    const home = homeRef.current;
    treeFocusRef.current = null;
    setTreeFocusId(null);
    glidePlaces({});
    if (!home) return;
    flyTo(home.zoom, home.pan, () => {
      if (homeRef.current === home) homeRef.current = null;
    });
  }

  useEffect(() => {
    const motion = motionRef.current;
    return () => {
      cancelAnimationFrame(motion.raf);
      cancelAnimationFrame(flyRef.current);
      window.clearTimeout(hoverSlideRef.current);
    };
  }, []);

  function kick(dx: number, dy: number, pointerX: number, pointerY: number) {
    const motion = motionRef.current;
    motion.velX = clampMotion(motion.velX * 0.5 + dx, 42);
    motion.velY = clampMotion(motion.velY * 0.5 + dy, 42);
    motion.pointerX = pointerX;
    motion.pointerY = pointerY;
    if (!motion.raf) motion.raf = requestAnimationFrame(stepMotion);
  }

  function stepMotion() {
    const motion = motionRef.current;
    motion.velX *= 0.84;
    motion.velY *= 0.84;
    const scaleNow = Math.max(0.35, scaleMotionRef.current);
    let energy = Math.abs(motion.velX) + Math.abs(motion.velY);
    for (const node of nodesRef.current) {
      let pull = motion.pulls.get(node.id);
      if (!pull) {
        pull = { x: 0, y: 0 };
        motion.pulls.set(node.id, pull);
      }
      const centerX = panRef.current.x + (node.x + FAMILY_NODE_SIZE.width / 2) * scaleNow;
      const centerY = panRef.current.y + (node.y + FAMILY_NODE_SIZE.height / 2) * scaleNow;
      const distance = Math.hypot(centerX - motion.pointerX, centerY - motion.pointerY);
      const reach = Math.min(1, distance / 420);
      const lag = 0.04 + reach * 1.85;
      const ease = 0.46 - reach * 0.3;
      const targetX = clampMotion(-motion.velX * lag, 36) / scaleNow;
      const targetY = clampMotion(-motion.velY * lag, 36) / scaleNow;
      pull.x += (targetX - pull.x) * ease;
      pull.y += (targetY - pull.y) * ease;
      energy += Math.abs(pull.x) + Math.abs(pull.y);
    }
    if (energy > 0.45) motion.raf = requestAnimationFrame(stepMotion);
    else {
      motion.velX = 0;
      motion.velY = 0;
      motion.raf = 0;
      for (const pull of motion.pulls.values()) {
        pull.x = 0;
        pull.y = 0;
      }
    }
    setMotionFrame((frame) => frame + 1);
  }

  function pullOf(id: string) {
    void motionFrame;
    return motionRef.current.pulls.get(id) ?? { x: 0, y: 0 };
  }

  function householdLinks() {
    if (!treeFocusId || !focused) return [];
    const person = people.find((item) => item.id === treeFocusId);
    if (!person) return [];
    const spot = (id: string) => {
      const node = layout.nodes.find((item) => item.id === id);
      if (!node) return null;
      const pull = pullOf(id);
      const shift = placed[id] ?? { x: 0, y: 0 };
      return { x: node.x + pull.x + shift.x, y: node.y + pull.y + shift.y };
    };
    const home = spot(person.id);
    if (!home) return [];
    const width = FAMILY_NODE_SIZE.width;
    const height = FAMILY_NODE_SIZE.height;
    const links: Array<{ key: string; d: string }> = [];
    for (const parent of people) {
      if (!focused.has(parent.id) || !person.parentNames.some((name) => sameName(name, parent.name))) continue;
      const place = spot(parent.id);
      if (!place) continue;
      links.push({
        key: `parent-${parent.id}`,
        d: smoothLink(place.x + width / 2, place.y + height, home.x + width / 2, home.y),
      });
    }
    const partner = people.find(
      (other) => other.id !== person.id && focused.has(other.id) && (sameName(other.name, person.wifeName) || sameName(other.wifeName, person.name)),
    );
    let originX = home.x + width / 2;
    let originY = home.y + height;
    if (partner) {
      const place = spot(partner.id);
      if (place) {
        links.push({
          key: `spouse-${partner.id}`,
          d: `M ${home.x + width} ${home.y + height / 2} L ${place.x} ${place.y + height / 2}`,
        });
        originX = (home.x + width + place.x) / 2;
        originY = Math.max(home.y, place.y) + height;
      }
    }
    for (const child of people) {
      if (!focused.has(child.id) || !child.role || !child.parentNames.some((name) => sameName(name, person.name))) continue;
      const place = spot(child.id);
      if (!place) continue;
      links.push({ key: `child-${child.id}`, d: smoothLink(originX, originY, place.x + width / 2, place.y) });
    }
    return links;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const focusedTree = Boolean(treeFocusId) && !selectedIdRef.current;
    if (!focusedTree) {
      cancelFly();
      if (!selectedIdRef.current) {
        homeRef.current = null;
        settleRef.current();
      }
    }
    let lastX = event.clientX;
    let lastY = event.clientY;
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        setPanning(true);
        if (focusedTree) cancelFly();
      }
      const frame = frameRef.current;
      const dx = moveEvent.clientX - lastX;
      const dy = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      const next = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      panRef.current = next;
      setPan(next);
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      kick(dx, dy, moveEvent.clientX - rect.left, moveEvent.clientY - rect.top);
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && focusedTree) returnHome();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const familyModal =
    creating || selected
      ? createPortal(
          <PersonModal
            person={creating ? null : selected}
            people={people}
            options={options}
            photos={photos}
            seed={creating ? seed : null}
            onSelect={(id) => openPerson(id)}
            onClose={() => {
              setCreating(false);
              setSeed(null);
              setSelectedId(null);
              returnHome();
            }}
            onSaved={(next, id) => {
              setPeople(next);
              if (id) {
                setCreating(false);
                setSeed(null);
                setSelectedId(id);
              }
            }}
          />,
          document.body,
        )
      : null;

  if (people.length === 0) {
    return (
      <div className="family-layout">
        <div className="family-actions">
          <button type="button" onClick={() => setCreating(true)}>
            Add family member
          </button>
        </div>
        {familyModal}
        <p className="empty-list">Add a family member, or tag a person on a photo.</p>
      </div>
    );
  }

  return (
    <div className="family-layout">
      <div className="family-actions">
        <button
          type="button"
          onClick={() => {
            cancelFly();
            homeRef.current = null;
            settleRef.current();
            setSelectedId(null);
            setSeed(null);
            setCreating(true);
          }}
        >
          Add family member
        </button>
      </div>
      <div className="tree-stage">
        <div className="tree-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button type="button" aria-label="Fit the tree" onClick={fitTree}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            +
          </button>
        </div>
        {treeFocusId && !selected && !creating ? (
          <button type="button" className="tree-close" onClick={() => returnHome()}>
            Close
          </button>
        ) : null}
        <div
          className={panning ? "tree-scroll is-panning" : "tree-scroll"}
          ref={frameRef}
          onPointerDown={onPointerDown}
        >
        <div className="tree-canvas" style={{ width: layout.width * scale, height: layout.height * scale, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <div className={treeFocusId ? "tree-scale is-focused" : "tree-scale"} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
          <svg className="tree-lines" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map((edge) => {
              const inTree = Boolean(treeFocusId && focused?.has(edge.fromId) && focused.has(edge.toId));
              if (inTree) return null;
              const from = pullOf(edge.fromId);
              const to = pullOf(edge.toId);
              const fromShift = placed[edge.fromId] ?? { x: 0, y: 0 };
              const toShift = placed[edge.toId] ?? { x: 0, y: 0 };
              const outside = focused ? !focused.has(edge.fromId) || !focused.has(edge.toId) : false;
              return (
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  d={smoothLink(edge.x1 + from.x + fromShift.x, edge.y1 + from.y + fromShift.y, edge.x2 + to.x + toShift.x, edge.y2 + to.y + toShift.y)}
                  className={outside ? (treeFocusId ? "is-aside" : "is-dimmed") : undefined}
                />
              );
            })}
            {householdLinks().map((link) => (
              <path key={link.key} d={link.d} className="is-active" />
            ))}
          </svg>
          {layout.unlinkedLabel ? (
            <p className="tree-unlinked" style={{ left: layout.unlinkedLabel.x, top: layout.unlinkedLabel.y }}>
              Not linked yet
            </p>
          ) : null}
          {layout.nodes.map((node) => {
            const pull = pullOf(node.id);
            const shift = placed[node.id] ?? { x: 0, y: 0 };
            const slots = layout.slots.filter((slot) => slot.personId === node.id);
            const record = people.find((person) => person.id === node.id);
            const homePerson = treeFocusId ? people.find((person) => person.id === treeFocusId) : undefined;
            const kin = Boolean(
              homePerson &&
                record &&
                node.id !== homePerson.id &&
                (homePerson.parentNames.some((name) => sameName(name, record.name)) ||
                  (record.role && record.parentNames.some((name) => sameName(name, homePerson.name)))),
            );
            const member = focused?.has(node.id) ?? false;
            const outside = focused ? !member : false;
            const className = [
              "tree-person",
              outside ? (treeFocusId ? "is-aside" : "is-dimmed") : "",
              member ? "is-focused" : "",
              kin ? "is-kin" : "",
              node.id === treeFocusId ? "is-home" : "",
              !treeFocusId && hoveredId === node.id ? "is-hovered" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const avatar = record?.avatar;
            const avatarTurn = avatar ? (photos.find((photo) => photo.sourcePath === avatar.sourcePath)?.rotation ?? 0) : 0;
            const reach = controlReach(slots, node.x, node.y);
            return (
              <div
                key={node.id}
                className={className}
                style={{
                  left: node.x,
                  top: node.y,
                  width: FAMILY_NODE_SIZE.width,
                  height: FAMILY_NODE_SIZE.height,
                  transform: `translate(${pull.x + shift.x}px, ${pull.y + shift.y}px)`,
                }}
                onMouseEnter={(event) => {
                  setHoveredId(node.id);
                  queueFamilySlide(node.id, event.clientX, event.clientY);
                }}
                onMouseLeave={() => {
                  setHoveredId((current) => (current === node.id ? null : current));
                  clearFamilySlide();
                }}
              >
                <span
                  className="tree-hover"
                  style={{ top: -reach.above, right: -10, bottom: -reach.below, left: -10 }}
                />
                {reach.side > 0 ? <span className="tree-hover tree-hover-side" style={{ width: reach.side }} /> : null}
                <div className="tree-card">
                  <button
                    type="button"
                    className={["tree-node", node.id === selectedId ? "is-selected" : "", node.id === viewerId ? "is-you" : ""].filter(Boolean).join(" ")}
                    title={node.name}
                    onClick={() => openPerson(node.id)}
                  >
                    {node.id === viewerId ? <em className="tree-you">You</em> : null}
                    <strong>{node.name}</strong>
                  </button>
                  <span className="tree-avatar" aria-hidden="true">
                    {avatar ? <img src={avatarSrc(avatar, avatarTurn)} alt="" /> : <span>{initials(node.name)}</span>}
                  </span>
                </div>
                <button
                  type="button"
                  className="tree-focus"
                  aria-label={`Focus on ${node.name}`}
                  onClick={() => focusPerson(node.id)}
                >
                  <FamilyMark kind="focus" />
                  Focus
                </button>
                {slots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    className={`tree-slot tree-slot-${slot.kind}`}
                    style={{ left: slot.x - node.x, top: slot.y - node.y, width: slot.width, height: slot.height }}
                    aria-label={`Add a ${slot.kind === "wife" ? "spouse" : slot.kind} of ${slot.anchorName}`}
                    onClick={() => {
                      cancelFly();
                      settleRef.current();
                      setSelectedId(null);
                      setSeed({ kind: slot.kind, anchorId: slot.personId });
                      setCreating(true);
                    }}
                  >
                    <FamilyMark kind={slot.kind === "wife" ? "spouse" : slot.kind} />
                    {slot.label}
                  </button>
                ))}
              </div>
            );
          })}
          </div>
        </div>
        </div>
      </div>
      {familyModal}
    </div>
  );
}

function smoothLink(x1: number, y1: number, x2: number, y2: number): string {
  const drop = Math.max(28, (y2 - y1) * 0.55);
  return `M ${x1} ${y1} C ${x1} ${y1 + drop}, ${x2} ${y2 - drop}, ${x2} ${y2}`;
}

function clampMotion(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function PersonModal({
  person,
  people,
  options,
  photos,
  seed,
  onSelect,
  onClose,
  onSaved,
}: {
  person: Person | null;
  people: Person[];
  options: KnownName[];
  photos: FamilyPhoto[];
  seed: FamilySeed | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSaved: (people: Person[], id?: string) => void;
}) {
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [name, setName] = useState(person?.name ?? "");
  const [role, setRole] = useState(person?.role ?? "");
  const [parents, setParents] = useState(person?.parentNames ?? []);
  const [parentDraft, setParentDraft] = useState("");
  const [siblings, setSiblings] = useState(person?.siblingNames ?? []);
  const [siblingDraft, setSiblingDraft] = useState("");
  const [wife, setWife] = useState(person?.wifeName ?? "");
  const [born, setBorn] = useState(person?.born ?? "");
  const [died, setDied] = useState(person?.died ?? "");
  const [birthplace, setBirthplace] = useState(person?.birthplace ?? "");
  const [home, setHome] = useState(person?.home ?? "");
  const [school, setSchool] = useState(person?.school ?? "");
  const [work, setWork] = useState(person?.work ?? "");
  const [linkRole, setLinkRole] = useState<"" | "daughter" | "son">("");
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState("");
  const [editing, setEditing] = useState(!person);
  const [shown, setShown] = useState(false);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  const openPhotoRef = useRef<string | null>(null);
  onCloseRef.current = onClose;
  openPhotoRef.current = openPhoto;
  const anchor = seed ? people.find((item) => item.id === seed.anchorId) ?? null : null;
  const selfName = (editing ? name : person?.name) || name;
  const adding = !person;
  const showOwnRole = !adding || !seed || seed.kind === "child";
  const heading = person?.name || seedTitle(seed, anchor);
  const children = person ? people.filter((item) => item.parentNames.some((parent) => sameName(parent, person.name)) && item.role) : [];
  const derivedSiblings = people.filter(
    (item) => item.id !== person?.id && parents.some((parent) => item.parentNames.some((parentName) => sameName(parentName, parent))),
  );
  const theirs = person ? photos.filter((photo) => photo.personIds.includes(person.id)) : [];
  const identity =
    person && person.role && person.parentNames.length > 0
      ? `${person.role[0].toUpperCase()}${person.role.slice(1)} of ${joinNames(person.parentNames)}`
      : "";
  const spouse = person?.wifeName ? people.find((item) => sameName(item.name, person.wifeName)) : undefined;
  const shownSiblings = person
    ? people.filter(
        (item) =>
          item.id !== person.id &&
          (person.parentNames.some((parent) => item.parentNames.some((name) => sameName(name, parent))) ||
            person.siblingNames.some((name) => sameName(name, item.name))),
      )
    : [];
  const gallery = theirs.map((photo) => photo.sourcePath);
  const profileClass = editing && !openPhoto && gallery.length > 0 ? "profile" : openPhoto ? "profile is-focus" : "profile is-plain";
  const turnFor = (file: string) => photos.find((photo) => photo.sourcePath.toLowerCase() === file.toLowerCase())?.rotation ?? 0;

  useEffect(() => {
    setEditing(!person);
    setName(person?.name ?? "");
    setRole(person?.role ?? "");
    setParents(person?.parentNames ?? (seed?.kind === "child" && anchor ? [anchor.name] : []));
    setParentDraft("");
    setSiblings(person?.siblingNames ?? []);
    setSiblingDraft("");
    setWife(person?.wifeName ?? "");
    setBorn(person?.born ?? "");
    setDied(person?.died ?? "");
    setBirthplace(person?.birthplace ?? "");
    setHome(person?.home ?? "");
    setSchool(person?.school ?? "");
    setWork(person?.work ?? "");
    setLinkRole("");
    setSaveError(null);
    setSavedNote("");
    setOpenPhoto(null);
  }, [person?.id, seed, anchor]);

  async function saveFamily(nextParents: string[], nextSiblings: string[]) {
    setPending(true);
    setSaveError(null);
    setSavedNote("");
    try {
      const payload = await postPerson(
        person
          ? { id: person.id, name: name.trim(), role, parents: nextParents, siblings: nextSiblings, wife: wife.trim(), born: born.trim(), died: died.trim(), birthplace: birthplace.trim(), home: home.trim(), school: school.trim(), work: work.trim() }
          : { name: name.trim(), role: showOwnRole ? role : "", parents: nextParents, siblings: nextSiblings, wife: wife.trim(), born: born.trim(), died: died.trim(), birthplace: birthplace.trim(), home: home.trim(), school: school.trim(), work: work.trim() },
      );
      if (!person && seed && anchor && payload.id) {
        const created = payload.people.find((item) => item.id === payload.id);
        const current = payload.people.find((item) => item.id === anchor.id);
        if (!created || !current) throw new Error("That could not be saved.");
        if (seed.kind === "wife") {
          const linked = await postPerson({
            id: current.id,
            role: current.role,
            parents: current.parentNames,
            siblings: current.siblingNames,
            wife: created.name,
          });
          onSaved(linked.people, created.id);
        } else if (seed.kind === "parent") {
          const nextRole = current.role || linkRole;
          if (nextRole !== "daughter" && nextRole !== "son") throw new Error("Choose daughter or son, and name at least one parent.");
          const linked = await postPerson({
            id: current.id,
            role: nextRole,
            parents: [...current.parentNames, created.name],
            siblings: current.siblingNames,
            wife: current.wifeName,
          });
          onSaved(linked.people, created.id);
        } else {
          onSaved(payload.people, payload.id);
        }
      } else {
        onSaved(payload.people, payload.id);
      }
      setSavedNote(person ? "Saved." : "Added.");
      if (person) setEditing(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(first);
  }, []);

  function beginClose() {
    if (closing.current) return;
    closing.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
      return;
    }
    setShown(false);
    window.setTimeout(() => onCloseRef.current(), 280);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openPhotoRef.current) {
        setOpenPhoto(null);
        return;
      }
      beginClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={shown ? "lightbox person-modal is-shown" : "lightbox person-modal"} role="dialog" aria-modal="true" aria-label={heading}>
      <button type="button" className="lightbox-backdrop" aria-label="Close" onClick={beginClose} />
      <div className={person ? "person-modal-card is-profile" : "person-modal-card"}>
        <div className={profileClass}>
          {person && openPhoto ? (
            <figure className="person-focus">
              <button type="button" className="photo-back" onClick={() => setOpenPhoto(null)}>
                All photos
              </button>
              <img src={mediaSrc(openPhoto, "full", turnFor(openPhoto))} alt="" />
            </figure>
          ) : null}
          {person && editing && !openPhoto && gallery.length > 0 ? (
            <div className="profile-portrait">
              <button type="button" className="profile-hero" aria-label={gallery[0]} onClick={() => setOpenPhoto(gallery[0])}>
                <img src={mediaSrc(gallery[0], "full", turnFor(gallery[0]))} alt="" />
              </button>
              {gallery.length > 1 ? (
                <ul className="profile-thumbs">
                  {gallery.slice(1).map((file) => (
                    <li key={file}>
                      <button type="button" aria-label={file} onClick={() => setOpenPhoto(file)}>
                        <img src={mediaSrc(file, "thumb", turnFor(file))} alt="" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="profile-body">
        <div className="lightbox-heading">
          <div>
            {person && editing ? (
              <input
                id="person-name"
                className="profile-name"
                form="family-edit"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Name"
                maxLength={80}
                autoFocus
              />
            ) : (
              <h2>{heading}</h2>
            )}
            {identity ? <p className="profile-identity">{identity}</p> : null}
          </div>
          <div className="heading-actions">
            {person && !editing ? (
              <button
                type="button"
                onClick={() => {
                  setName(person.name);
                  setRole(person.role);
                  setParents(person.parentNames);
                  setSiblings(person.siblingNames);
                  setWife(person.wifeName);
                  setBorn(person.born);
                  setDied(person.died);
                  setBirthplace(person.birthplace);
                  setHome(person.home);
                  setSchool(person.school);
                  setWork(person.work);
                  setParentDraft("");
                  setSiblingDraft("");
                  setSaveError(null);
                  setSavedNote("");
                  setEditing(true);
                }}
              >
                Edit
              </button>
            ) : null}
            <button type="button" onClick={beginClose}>
              Close
            </button>
          </div>
        </div>
        {person && !editing ? (
          <div hidden={Boolean(openPhoto)}>
            {savedNote ? <p className="count">{savedNote}</p> : null}
            <PersonProfile
              person={person}
              photos={theirs}
              onOpen={setOpenPhoto}
              facts={
                <ProfileFacts
                  onSelect={onSelect}
                  rows={[
                    { kind: "parent", label: "Parents", people: namedPeople(person.parentNames, people) },
                    { kind: "spouse", label: "Spouse", people: person.wifeName ? [{ key: spouse?.id ?? person.wifeName, name: person.wifeName, id: spouse?.id }] : [] },
                    { kind: "sibling", label: "Siblings", people: shownSiblings.map((sibling) => ({ key: sibling.id, name: sibling.name, id: sibling.id })) },
                    { kind: "child", label: "Children", people: children.map((child) => ({ key: child.id, name: child.name, id: child.id })) },
                  ]}
                />
              }
            />
          </div>
        ) : null}
        {person && !editing ? null : (
        <form
          id="family-edit"
          className="correction family-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              setSaveError("Type a name.");
              return;
            }
            if (seed?.kind === "parent" && anchor && !anchor.role && linkRole !== "daughter" && linkRole !== "son") {
              setSaveError("Choose daughter or son, and name at least one parent.");
              return;
            }
            const nextParents = withDraft(parents, parentDraft, selfName, 4);
            const draftedSiblings = withDraft(siblings, siblingDraft, selfName, 8);
            if (!nextParents || !draftedSiblings) {
              setSaveError("A person cannot be their own parent or sibling.");
              return;
            }
            const nextSiblings = draftedSiblings.filter(
              (name) => !nextParents.some((parent) => sameName(parent, name)) && !sameName(name, wife),
            );
            setParents(nextParents);
            setParentDraft("");
            setSiblings(nextSiblings);
            setSiblingDraft("");
            void saveFamily(nextParents, nextSiblings);
          }}
        >
          {person ? <AvatarCrop person={person} photos={photos} onSaved={(next) => onSaved(next)} /> : null}
          {person ? null : (
            <>
              <label htmlFor="person-name">Name</label>
              <input id="person-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Who are they?" maxLength={80} autoFocus />
            </>
          )}
          <div className="life-dates">
            <label htmlFor="person-born">
              Born
              <input id="person-born" type="date" value={born} onChange={(event) => setBorn(event.target.value)} />
            </label>
            <label htmlFor="person-died">
              Died
              <input id="person-died" type="date" value={died} onChange={(event) => setDied(event.target.value)} />
            </label>
          </div>
          <div className="life-notes">
            <label htmlFor="person-birthplace">
              Birthplace
              <input id="person-birthplace" value={birthplace} onChange={(event) => setBirthplace(event.target.value)} maxLength={120} />
            </label>
            <label htmlFor="person-home">
              Lived
              <input id="person-home" value={home} onChange={(event) => setHome(event.target.value)} maxLength={120} />
            </label>
            <label htmlFor="person-school">
              School
              <input id="person-school" value={school} onChange={(event) => setSchool(event.target.value)} maxLength={120} />
            </label>
            <label htmlFor="person-work">
              Work
              <input id="person-work" value={work} onChange={(event) => setWork(event.target.value)} maxLength={120} />
            </label>
          </div>
          {seed?.kind === "parent" && anchor && !anchor.role ? (
            <>
              <label>{anchor.name} is their</label>
              <div className="choice" role="group" aria-label={`${anchor.name} is their daughter or son`}>
                <button type="button" aria-pressed={linkRole === "daughter"} onClick={() => setLinkRole(linkRole === "daughter" ? "" : "daughter")}>
                  Daughter
                </button>
                <button type="button" aria-pressed={linkRole === "son"} onClick={() => setLinkRole(linkRole === "son" ? "" : "son")}>
                  Son
                </button>
              </div>
            </>
          ) : null}
          {showOwnRole ? (
            <div className="choice" role="group" aria-label="Daughter or son">
              <button type="button" aria-pressed={role === "daughter"} onClick={() => setRole(role === "daughter" ? "" : "daughter")}>
                Daughter
              </button>
              <button type="button" aria-pressed={role === "son"} onClick={() => setRole(role === "son" ? "" : "son")}>
                Son
              </button>
            </div>
          ) : null}
          {person || !seed || seed.kind === "child" ? (
            <>
          <label className="family-label">
            <FamilyMark kind="parent" />
            Parents
          </label>
          <NameList names={parents} people={people} onOpen={onSelect} onRemove={(name) => setParents((current) => current.filter((item) => !sameName(item, name)))} />
          {parents.length < 4 ? (
            <NameSearch
              mode="add"
              label="Search parents"
              value={parentDraft}
              options={options}
              exclude={[selfName, ...parents]}
              onChange={setParentDraft}
              onSelect={(picked) => {
                const next = withDraft(parents, picked, selfName, 4);
                if (!next) {
                  setSaveError("A person cannot be their own parent.");
                  return;
                }
                setSaveError(null);
                setParents(next);
                setParentDraft("");
              }}
            />
          ) : null}
            </>
          ) : null}
          {person || !seed ? (
            <>
          <label className="family-label">
            <FamilyMark kind="sibling" />
            Siblings
          </label>
          {derivedSiblings.length > 0 ? (
            <p className="person-links">
              {derivedSiblings.map((sibling) => (
                <button key={sibling.id} type="button" onClick={() => onSelect(sibling.id)}>
                  {sibling.name}
                </button>
              ))}
            </p>
          ) : null}
          <NameList
            names={siblings.filter((name) => !derivedSiblings.some((sibling) => sameName(sibling.name, name)))}
            people={people}
            onOpen={onSelect}
            onRemove={(name) => setSiblings((current) => current.filter((item) => !sameName(item, name)))}
          />
          {siblings.length < 8 ? (
            <NameSearch
              mode="add"
              label="Search siblings"
              value={siblingDraft}
              options={options}
              exclude={[selfName, ...parents, ...siblings, wife]}
              onChange={setSiblingDraft}
              onSelect={(picked) => {
                const next = withDraft(siblings, picked, selfName, 8);
                if (!next) {
                  setSaveError("A person cannot be their own sibling.");
                  return;
                }
                setSaveError(null);
                setSiblings(next.filter((name) => !parents.some((parent) => sameName(parent, name))));
                setSiblingDraft("");
              }}
            />
          ) : null}
            </>
          ) : null}
          {person || !seed ? (
            <>
          <label className="family-label" htmlFor="person-wife">
            <FamilyMark kind="spouse" />
            Spouse
          </label>
          <NameSearch
            mode="field"
            id="person-wife"
            label="Search for a spouse"
            value={wife}
            options={options}
            exclude={[selfName, ...parents, ...siblings]}
            onChange={setWife}
          />
            </>
          ) : null}
          <div className="correction-actions">
            <button type="submit" disabled={pending}>
              {pending ? "Saving" : person ? "Save family" : seed ? `Add ${slotLabel(seed.kind)}` : "Add to the family"}
            </button>
            {person ? (
              <button type="button" className="cancel" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </button>
            ) : null}
          </div>
          {saveError ? <p className="notice">{saveError}</p> : null}
          {savedNote ? <p className="count">{savedNote}</p> : null}
        </form>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

function namedPeople(names: string[], people: Person[]): { key: string; name: string; id?: string }[] {
  return names.map((name) => {
    const match = people.find((item) => sameName(item.name, name));
    return { key: match?.id ?? name, name, id: match?.id };
  });
}

function ProfileFacts({
  rows,
  onSelect,
}: {
  rows: { kind: FamilyMarkKind; label: string; people: { key: string; name: string; id?: string }[] }[];
  onSelect: (id: string) => void;
}) {
  const visible = rows;
  return (
    <dl className="profile-facts">
      {visible.map((row) => (
        <div key={row.label}>
          <dt>
            <FamilyMark kind={row.kind} />
            {row.label}
          </dt>
          <dd>
            {row.people.length > 0 ? (
              row.people.map((item) =>
                item.id ? (
                  <button key={item.key} type="button" onClick={() => onSelect(item.id!)}>
                    {item.name}
                  </button>
                ) : (
                  <span key={item.key}>{item.name}</span>
                ),
              )
            ) : (
              <span className="about-blank">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type FamilyMarkKind = "parent" | "spouse" | "sibling" | "child" | "focus";

function FamilyMark({ kind }: { kind: FamilyMarkKind }) {
  return (
    <svg className="family-mark" viewBox="0 0 24 24" aria-hidden="true">
      {kind === "parent" ? (
        <>
          <path d="M9.2 5.2 12 2.6l2.8 2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 19.4c.8-2.8 2.6-4.2 5-4.2s4.2 1.4 5 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {kind === "child" ? (
        <>
          <circle cx="12" cy="8.2" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 17.6c.8-2.8 2.6-4.2 5-4.2s4.2 1.4 5 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M9.2 20.2 12 22.6l2.8-2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {kind === "sibling" ? (
        <>
          <circle cx="8" cy="8.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="16" cy="8.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.4 17.8c.6-2.2 1.9-3.3 3.6-3.3s3 1.1 3.6 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12.4 17.8c.6-2.2 1.9-3.3 3.6-3.3s3 1.1 3.6 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {kind === "spouse" ? (
        <path
          d="M12 18.5s-5.4-3.2-5.4-7.2a3 3 0 0 1 5.4-1.8 3 3 0 0 1 5.4 1.8c0 4-5.4 7.2-5.4 7.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      ) : null}
      {kind === "focus" ? (
        <>
          <circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

function NameList({
  names,
  people,
  onOpen,
  onRemove,
}: {
  names: string[];
  people: Person[];
  onOpen: (id: string) => void;
  onRemove: (name: string) => void;
}) {
  if (names.length === 0) return null;
  return (
    <ul className="parent-chips">
      {names.map((name) => {
        const match = people.find((item) => sameName(item.name, name));
        return (
          <li key={name}>
            {match ? (
              <button type="button" onClick={() => onOpen(match.id)}>
                {name}
              </button>
            ) : (
              <span>{name}</span>
            )}
            <button type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(name)}>
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function slotLabel(kind: FamilySlot["kind"]): string {
  return kind === "wife" ? "spouse" : kind;
}

function seedTitle(seed: FamilySeed | null, anchor: Person | null): string {
  if (!seed || !anchor) return "Add a family member";
  if (seed.kind === "parent") return `Add a parent of ${anchor.name}`;
  if (seed.kind === "wife") return `Add a spouse of ${anchor.name}`;
  return `Add a child of ${anchor.name}`;
}

async function postPerson(body: Record<string, unknown>): Promise<{ people: Person[]; id?: string }> {
  const response = await fetch("/api/person", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { people?: Person[]; id?: string; error?: string };
  if (!response.ok || !payload.people) throw new Error(payload.error || "That could not be saved.");
  return { people: payload.people, id: payload.id };
}

function withDraft(names: string[], draft: string, self: string, limit: number): string[] | null {
  const next = draft.trim().replace(/\s+/g, " ");
  if (!next) return names;
  if (sameName(next, self)) return null;
  if (names.some((name) => sameName(name, next)) || names.length >= limit) return names;
  return [...names, next];
}

function mediaSrc(sourcePath: string, size: "thumb" | "full", rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}${turn}`;
}

function avatarSrc(avatar: PersonAvatar, rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=thumb&path=${encodeURIComponent(avatar.sourcePath)}&ax=${avatar.x}&ay=${avatar.y}&aw=${avatar.w}&ah=${avatar.h}${turn}`;
}

function initials(name: string): string {
  const words = name.replace(/\([^)]*\)/g, " ").split(/[\s,-]+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
