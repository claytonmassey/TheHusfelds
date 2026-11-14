"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import { NameSearch } from "@/components/name-search";
import { mergeKnownNames, type KnownName } from "@/lib/known-name";
import type { GalleryImage } from "@/lib/library-view";
import { leadSearchTerm, mapHref, pageLeads, type PageLead } from "@/lib/page-leads";
import { marksIn, pageParagraphs, pageSummary, peopleInOrder } from "@/lib/page-text";
import { ITEM_TYPES, joinNames, sameName, turnPoint, turnRotation, type ItemTypeId, type Person, type PhotoPin, type PhotoRecord } from "@/lib/photo-types";

type LibraryPayload = {
  categories: string[];
  people: Person[];
  record: PhotoRecord;
  text?: string;
  warning?: string;
  error?: string;
};

export function PhotoDetail({
  image,
  note,
  onClose,
  onSaved,
  onTagged,
  onTurned,
}: {
  image: GalleryImage;
  note: string;
  onClose: () => void;
  onSaved: (note: string) => void;
  onTagged: (update: { labels: string[]; tagged: boolean }) => void;
  onTurned: (rotation: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [categories, setCategories] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [roster, setRoster] = useState<KnownName[]>([]);
  const [record, setRecord] = useState<PhotoRecord | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [pinsHidden, setPinsHidden] = useState(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<"person" | "thing">("person");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"" | "daughter" | "son">("");
  const [parentList, setParentList] = useState<string[]>([]);
  const [parentDraft, setParentDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState(note);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [pageText, setPageText] = useState("");
  const [textReady, setTextReady] = useState(false);
  const [pane, setPane] = useState<"read" | "details">(image.group === "writing" ? "read" : "details");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPageText("");
    setTextReady(false);
    setPane(image.group === "writing" ? "read" : "details");
  }, [image.sourcePath, image.group]);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/photo-record?path=${encodeURIComponent(image.sourcePath)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<LibraryPayload>)
      .then((payload) => {
        if (cancel || payload.error || !payload.record) return;
        setCategories(payload.categories);
        setPeople(payload.people);
        setRecord(payload.record);
        setNoteDraft(payload.record.note || note);
        setPageText(payload.text ?? "");
        setTextReady(true);
      })
      .catch(() => {
        if (!cancel) {
          setError("The photo details could not be loaded.");
          setTextReady(true);
        }
      });
    return () => {
      cancel = true;
    };
  }, [image.sourcePath, note]);

  useEffect(() => {
    let cancel = false;
    fetch("/api/names", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ names?: KnownName[] }>)
      .then((payload) => {
        if (!cancel && Array.isArray(payload.names)) setRoster(payload.names);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const rotation = record?.rotation ?? image.rotation ?? 0;

  useEffect(() => {
    const photo = imageRef.current;
    const stage = stageRef.current;
    if (!photo || !stage) return;
    const measure = () => {
      if (!photo.naturalWidth || !photo.naturalHeight) return;
      const imageRect = photo.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const ratio = photo.naturalWidth / photo.naturalHeight;
      const boxRatio = imageRect.width / Math.max(imageRect.height, 1);
      let width = imageRect.width;
      let height = imageRect.height;
      let offsetX = 0;
      let offsetY = 0;
      if (boxRatio > ratio) {
        width = imageRect.height * ratio;
        offsetX = (imageRect.width - width) / 2;
      } else {
        height = imageRect.width / ratio;
        offsetY = (imageRect.height - height) / 2;
      }
      setBox({
        left: imageRect.left - stageRect.left + offsetX,
        top: imageRect.top - stageRect.top + offsetY,
        width,
        height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(photo);
    observer.observe(stage);
    photo.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      photo.removeEventListener("load", measure);
    };
  }, [image.sourcePath, rotation]);

  const choices = useMemo(() => mergeKnownNames(roster, people), [roster, people]);
  const known = choices.find((person) => sameName(person.name, name));
  const showParents = kind === "person" && name.trim().length > 0;

  async function send(body: object) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/photo-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: image.sourcePath, ...body }),
      });
      const payload = (await response.json()) as LibraryPayload;
      if (!response.ok || !payload.record) throw new Error(payload.error || "That could not be saved.");
      setCategories(payload.categories);
      setPeople(payload.people);
      setRecord(payload.record);
      setNoteDraft(payload.record.note);
      onSaved(payload.record.note);
      onTagged({
        labels: payload.record.pins.filter((pin) => pin.kind === "person").map((pin) => pin.label),
        tagged:
          payload.record.types.length + payload.record.categories.length + payload.record.pins.length > 0 ||
          Boolean(payload.record.note.trim()),
      });
      setMessage(payload.warning ?? "Saved.");
      return payload.record;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function saveCategories(nextTypes: ItemTypeId[], nextCategories: string[]) {
    const previous = record;
    setRecord((current) => (current ? { ...current, types: nextTypes, categories: nextCategories } : current));
    const saved = await send({ action: "categories", types: nextTypes, categories: nextCategories });
    if (!saved && previous) setRecord(previous);
    if (saved) setCategoryDraft("");
  }

  function photoPoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage || !box.width || !box.height) return null;
    const stageRect = stage.getBoundingClientRect();
    const x = (clientX - stageRect.left - box.left) / box.width;
    const y = (clientY - stageRect.top - box.top) / box.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  }

  function onPhotoClick(event: MouseEvent<HTMLImageElement>) {
    const point = photoPoint(event.clientX, event.clientY);
    if (!point) return;
    setEditingId(null);
    setDraft(point);
    setKind("person");
    setName("");
    setRole("");
    setParentList([]);
    setParentDraft("");
    setError(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function onPinPointerDown(event: PointerEvent<HTMLButtonElement>, pin: PhotoPin) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: pin.id, x: pin.x, y: pin.y, originX: pin.x, originY: pin.y, moved: false });
  }

  function onPinPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const pinId = event.currentTarget.dataset.pinId;
    const point = photoPoint(event.clientX, event.clientY);
    if (!point || !pinId) return;
    setDrag((current) => {
      if (!current || current.id !== pinId) return current;
      const moved = Math.hypot(point.x - current.originX, point.y - current.originY) > 0.012;
      return { ...current, x: moved ? point.x : current.originX, y: moved ? point.y : current.originY, moved };
    });
  }

  function onPinPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const pinId = event.currentTarget.dataset.pinId ?? "";
    const current = dragRef.current;
    setDrag(null);
    if (!current || current.id !== pinId || !current.moved) return;
    const point = photoPoint(event.clientX, event.clientY) ?? { x: current.x, y: current.y };
    void movePin(pinId, point.x, point.y);
  }

  async function movePin(pinId: string, x: number, y: number) {
    const previous = record;
    setRecord((current) =>
      current ? { ...current, pins: current.pins.map((pin) => (pin.id === pinId ? { ...pin, x, y } : pin)) } : current,
    );
    try {
      const response = await fetch("/api/photo-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: image.sourcePath, action: "move", pinId, x, y }),
      });
      const payload = (await response.json()) as LibraryPayload;
      if (!response.ok || !payload.record) throw new Error(payload.error || "That could not be saved.");
      setRecord(payload.record);
    } catch (caught) {
      if (previous) setRecord(previous);
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    }
  }

  function addParent(raw = parentDraft) {
    const next = raw.trim().replace(/\s+/g, " ");
    if (!next) return;
    if (sameName(next, name)) {
      setError("A person cannot be their own parent.");
      return;
    }
    setError(null);
    setParentList((current) => {
      if (current.some((item) => sameName(item, next)) || current.length >= 4) return current;
      return [...current, next];
    });
    setParentDraft("");
  }

  function startEdit(pin: PhotoPin) {
    const person = people.find((item) => item.id === pin.personId);
    setDraft(null);
    setEditingId(pin.id);
    setKind(pin.kind);
    setName(pin.label);
    setRole(person?.role ?? "");
    setParentList(person?.parentNames ?? []);
    setParentDraft("");
    setError(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function closeEditor() {
    setDraft(null);
    setEditingId(null);
    setParentDraft("");
  }

  async function onTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (!draft && !editingId)) return;
    const parents = parentsToSave();
    if (!parents) return;
    const saved = await send(
      editingId
        ? { action: "edit", pinId: editingId, kind, name, role: showParents ? role : "", parents }
        : { action: "tag", x: draft?.x, y: draft?.y, kind, name, role: showParents ? role : "", parents },
    );
    if (saved) closeEditor();
  }

  function parentsToSave(): string[] | null {
    if (!showParents) return [];
    const pendingName = parentDraft.trim().replace(/\s+/g, " ");
    if (!pendingName) return parentList;
    if (sameName(pendingName, name)) {
      setError("A person cannot be their own parent.");
      return null;
    }
    if (parentList.some((item) => sameName(item, pendingName)) || parentList.length >= 4) return parentList;
    const next = [...parentList, pendingName];
    setParentList(next);
    setParentDraft("");
    return next;
  }

  async function rotate(direction: "left" | "right") {
    if (!record || pending) return;
    const previous = record;
    setRecord({
      ...previous,
      rotation: turnRotation(previous.rotation, direction),
      pins: previous.pins.map((pin) => ({ ...pin, ...turnPoint(pin.x, pin.y, direction) })),
    });
    const saved = await send({ action: "rotate", direction });
    if (!saved) setRecord(previous);
    else onTurned(saved.rotation);
  }

  const types = record?.types ?? [];
  const selectedCategories = record?.categories ?? [];
  const pins = record?.pins ?? [];
  const tagging = Boolean(draft || editingId);
  const paragraphs = useMemo(() => pageParagraphs(pageText), [pageText]);
  const summary = useMemo(() => pageSummary(paragraphs), [paragraphs]);
  const mentioned = useMemo(
    () =>
      peopleInOrder(paragraphs, people).flatMap((id) => {
        const person = people.find((item) => item.id === id);
        return person ? [person] : [];
      }),
    [paragraphs, people],
  );

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.filename}>
      <button type="button" className="lightbox-backdrop" aria-label="Close photo" onClick={onClose} />
      <div className="lightbox-card">
        <div className="photo-stage" ref={stageRef}>
          <img ref={imageRef} src={mediaSrc(image.sourcePath, "full", rotation)} alt={image.filename} onClick={onPhotoClick} />
          <div className="photo-rotate" role="group" aria-label="Rotate photo">
            <button type="button" aria-label="Rotate left" disabled={pending || !record} onClick={() => void rotate("left")}>
              ↺
            </button>
            <button type="button" aria-label="Rotate right" disabled={pending || !record} onClick={() => void rotate("right")}>
              ↻
            </button>
          </div>
          {pins.length > 0 ? (
            <button type="button" className="pin-visibility" onClick={() => setPinsHidden((hidden) => !hidden)}>
              {pinsHidden ? "Show tags" : "Hide tags"}
            </button>
          ) : null}
          {box.width > 0 ? (
            <div className="pin-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              {pinsHidden
                ? null
                : pins.map((pin) => {
                    const placed = drag?.id === pin.id ? drag : pin;
                    return (
                      <button
                        key={pin.id}
                        type="button"
                        className={drag?.id === pin.id ? "pin is-dragging" : "pin"}
                        style={{ left: `${placed.x * 100}%`, top: `${placed.y * 100}%` }}
                        data-pin-id={pin.id}
                        aria-label={`${pin.label}. Drag to move.`}
                        onPointerDown={(event) => onPinPointerDown(event, pin)}
                        onPointerMove={onPinPointerMove}
                        onPointerUp={onPinPointerUp}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <i />
                        <span>{pin.label}</span>
                      </button>
                    );
                  })}
              {draft ? <span className="pin is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}><i /></span> : null}
            </div>
          ) : null}
        </div>
        <div className="lightbox-copy">
          <div className="lightbox-heading">
            <h2>{image.filename}</h2>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>

          {tagging ? null : (
            <div className="page-switch" role="tablist" aria-label="Photo tools">
              <button type="button" role="tab" aria-selected={pane === "read"} onClick={() => setPane("read")}>
                Read
              </button>
              <button type="button" role="tab" aria-selected={pane === "details"} onClick={() => setPane("details")}>
                Details
              </button>
            </div>
          )}

          {tagging || pane !== "details" ? null : (
          <section className="tag-groups page-card">
            <h3>Type</h3>
            <div className="choice" role="group" aria-label="Type">
              {ITEM_TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={types.includes(item.id)}
                  disabled={pending || !record}
                  onClick={() => {
                    const next = types.includes(item.id) ? types.filter((type) => type !== item.id) : [...types, item.id];
                    void saveCategories(next, selectedCategories);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <h3>Categories</h3>
            {categories.length > 0 ? (
              <div className="choice" role="group" aria-label="Categories">
                {categories.map((category) => {
                  const pressed = selectedCategories.some((item) => sameName(item, category));
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={pressed}
                      disabled={pending || !record}
                      onClick={() => {
                        const next = pressed
                          ? selectedCategories.filter((item) => !sameName(item, category))
                          : [...selectedCategories, category];
                        void saveCategories(types, next);
                      }}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <form
              className="category-add"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = categoryDraft.trim();
                if (!nextName || !record) return;
                const existing = categories.find((category) => sameName(category, nextName));
                const next = selectedCategories.some((category) => sameName(category, existing ?? nextName))
                  ? selectedCategories
                  : [...selectedCategories, existing ?? nextName];
                void saveCategories(types, next);
              }}
            >
              <input
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
                placeholder="Add a category"
                aria-label="Add a category"
                maxLength={40}
              />
              <button type="submit" disabled={pending || categoryDraft.trim().length === 0}>
                Add
              </button>
            </form>
          </section>
          )}

          {tagging || pane === "details" ? (
          <section className={tagging ? "tag-groups" : "tag-groups page-card"}>
            <h3>{tagging ? (editingId ? "Edit" : "Tag") + (kind === "person" ? " person" : " thing") : "People and things"}</h3>
            {tagging ? null : <p className="count">Click the photo to add a tag. Drag a dot to move it.</p>}
            {tagging ? (
              <form className="correction" onSubmit={onTag}>
                <div className="choice" role="group" aria-label="Tag kind">
                  <button type="button" aria-pressed={kind === "person"} onClick={() => setKind("person")}>
                    Person
                  </button>
                  <button type="button" aria-pressed={kind === "thing"} onClick={() => setKind("thing")}>
                    Thing
                  </button>
                </div>
                <label htmlFor="tag-name">Name</label>
                {kind === "person" ? (
                  <NameSearch
                    mode="field"
                    id="tag-name"
                    inputRef={nameRef}
                    label="Who is this?"
                    value={name}
                    options={choices}
                    onChange={(next) => {
                      setName(next);
                      const match = choices.find((person) => sameName(person.name, next));
                      if (match && !editingId) {
                        setRole(match.role);
                        setParentList(match.parentNames);
                      }
                    }}
                  />
                ) : (
                  <input
                    id="tag-name"
                    ref={nameRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="What is this?"
                    maxLength={80}
                  />
                )}
                {known && !editingId ? (
                  <p className="count">
                    {known.role && known.parentNames.length > 0
                      ? `${known.name} is the ${known.role} of ${joinNames(known.parentNames)}.`
                      : known.where === "draft"
                        ? "In the draft."
                        : "Already in the family tree."}
                  </p>
                ) : null}
                {showParents ? (
                  <div className="parent-editor">
                    <div className="choice" role="group" aria-label="Daughter or son">
                      <button type="button" aria-pressed={role === "daughter"} onClick={() => setRole(role === "daughter" ? "" : "daughter")}>
                        Daughter
                      </button>
                      <button type="button" aria-pressed={role === "son"} onClick={() => setRole(role === "son" ? "" : "son")}>
                        Son
                      </button>
                    </div>
                    {parentList.length > 0 ? (
                      <ul className="parent-chips">
                        {parentList.map((parent) => (
                          <li key={parent}>
                            <span>{parent}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${parent}`}
                              onClick={() => setParentList((current) => current.filter((item) => !sameName(item, parent)))}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {parentList.length < 4 ? (
                      <div className="parent-row">
                        <span>of</span>
                        <NameSearch
                          mode="add"
                          label="Search parents"
                          value={parentDraft}
                          options={choices}
                          exclude={[name, ...parentList]}
                          onChange={setParentDraft}
                          onSelect={(picked) => addParent(picked)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="correction-actions">
                  <button type="submit" disabled={pending || name.trim().length === 0}>
                    {pending ? "Saving" : editingId ? "Save changes" : "Save tag"}
                  </button>
                  <button type="button" onClick={closeEditor}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
            {tagging || pins.length === 0 ? null : (
              <ul className="pin-list">
                {pins.map((pin) => (
                  <PinRow
                    key={pin.id}
                    pin={pin}
                    people={people}
                    pending={pending}
                    onEdit={() => startEdit(pin)}
                    onRemove={() => void send({ action: "untag", pinId: pin.id })}
                  />
                ))}
              </ul>
            )}
          </section>
          ) : null}

          {tagging || pane !== "read" ? null : (
            <PageReading ready={textReady} sourcePath={image.sourcePath} summary={summary} paragraphs={paragraphs} mentioned={mentioned} people={people} />
          )}

          {tagging || pane !== "details" ? null : (
          <form
            className="correction page-card"
            onSubmit={(event) => {
              event.preventDefault();
              void send({ action: "note", note: noteDraft });
            }}
          >
            <label htmlFor="photo-context">Add context</label>
            <textarea
              id="photo-context"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={4}
              placeholder="Who is this, and how do they connect to the family?"
            />
            <div className="correction-actions">
              <button type="submit" disabled={pending || noteDraft.trim().length === 0}>
                {pending ? "Saving" : "Save for the AI"}
              </button>
            </div>
          </form>
          )}
          {message ? <p className="count">{message}</p> : null}
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

type PageEdit = {
  id: string;
  by: string;
  at: string;
  text: string;
};

type PageHit = {
  filename: string;
  excerpt: string;
};

function PageReading({
  ready,
  sourcePath,
  summary,
  paragraphs,
  mentioned,
  people,
}: {
  ready: boolean;
  sourcePath: string;
  summary: string;
  paragraphs: string[];
  mentioned: Person[];
  people: Person[];
}) {
  const leads = useMemo(() => pageLeads(paragraphs, summary), [paragraphs, summary]);
  const [edits, setEdits] = useState<PageEdit[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [citesOpen, setCitesOpen] = useState(false);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [hits, setHits] = useState<PageHit[] | null>(null);
  const [english, setEnglish] = useState<{ language: string; paragraphs: string[] } | null>(null);
  const [showEnglish, setShowEnglish] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setEdits([]);
    setEditing(false);
    setCitesOpen(false);
    setOpenLead(null);
    setEditError(null);
    setEnglish(null);
    setShowEnglish(false);
    setTranslateError(null);
    fetch(`/api/page-notes?path=${encodeURIComponent(sourcePath)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ edits?: PageEdit[] }>)
      .then((payload) => {
        if (!cancel && Array.isArray(payload.edits)) setEdits(payload.edits);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [sourcePath]);

  const active = leads.find((lead) => lead.id === openLead) ?? null;
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    setHits(null);
    fetch(`/api/page-search?path=${encodeURIComponent(sourcePath)}&q=${encodeURIComponent(leadSearchTerm(active.label))}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ hits?: PageHit[] }>)
      .then((payload) => {
        if (!cancel) setHits(Array.isArray(payload.hits) ? payload.hits : []);
      })
      .catch(() => {
        if (!cancel) setHits([]);
      });
    return () => {
      cancel = true;
    };
  }, [active?.id, active?.label, sourcePath]);

  if (!ready) return <p className="count">Reading the page…</p>;
  if (!summary && edits.length === 0) return <p className="page-empty">No writing was found on this photo.</p>;
  const shown = edits[edits.length - 1]?.text || summary;
  const showPrint = paragraphs.length > 1 || paragraphs.join(" ").length > shown.length + 24;

  async function translate() {
    if (english) {
      if (english.language.toLowerCase() !== "english") setShowEnglish(true);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: paragraphs.join("\n\n") }),
      });
      const payload = (await response.json()) as { language?: string; english?: string; error?: string };
      if (!response.ok || !payload.english) throw new Error(payload.error || "The translation did not come back.");
      const language = payload.language?.trim() || "another language";
      const parts = payload.english
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean);
      setEnglish({ language, paragraphs: parts.length > 0 ? parts : [payload.english.trim()] });
      setShowEnglish(language.toLowerCase() !== "english");
    } catch (caught) {
      setTranslateError(caught instanceof Error ? caught.message : "The translation did not come back.");
    } finally {
      setTranslating(false);
    }
  }

  async function saveDetail() {
    setSaving(true);
    setEditError(null);
    try {
      const response = await fetch("/api/page-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, text: draftText }),
      });
      const payload = (await response.json()) as { edits?: PageEdit[]; error?: string };
      if (!response.ok || !payload.edits) throw new Error(payload.error || "That detail could not be saved.");
      setEdits(payload.edits);
      setEditing(false);
      setCitesOpen(true);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "That detail could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-read">
      <section className="page-card">
        <div className="page-card-head">
          <h3>
            Summary
            {edits.length > 0 ? (
              <button type="button" className="page-cite" aria-expanded={citesOpen} onClick={() => setCitesOpen((open) => !open)}>
                {edits.length}
              </button>
            ) : null}
          </h3>
          {editing ? null : (
            <button
              type="button"
              className="page-edit"
              onClick={() => {
                setDraftText(shown);
                setEditError(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <form
            className="page-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDetail();
            }}
          >
            <label className="editor-kicker" htmlFor="page-detail">
              Detail
            </label>
            <textarea id="page-detail" value={draftText} onChange={(event) => setDraftText(event.target.value)} rows={5} />
            <div className="correction-actions">
              <button type="submit" disabled={saving || draftText.trim().length === 0}>
                {saving ? "Saving" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            {editError ? <p className="notice">{editError}</p> : null}
          </form>
        ) : (
          <p className="page-summary">
            <Marked text={shown} people={people} />
          </p>
        )}
        {citesOpen && edits.length > 0 ? (
          <ol className="page-cites">
            {[...edits].reverse().map((edit) => (
              <li key={edit.id}>
                <strong>{edit.by}</strong>
                <time dateTime={edit.at}>{citeWhen(edit.at)}</time>
                <p>{edit.text}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {leads.length > 0 ? (
        <section className="page-card page-insights">
          <h3>AI insights</h3>
          <p className="count">Places and events this page supports. Open one for the passage and a map.</p>
          <ul className="insight-list">
            {leads.map((lead) => {
              const open = lead.id === openLead;
              return (
                <li key={lead.id}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenLead((current) => (current === lead.id ? null : lead.id))}>
                    <span className="page-cue">{lead.cue}</span>
                    <strong>{lead.label}</strong>
                    <em>{Math.round(lead.score * 100)}%</em>
                  </button>
                  {open ? <LeadDetail lead={lead} hits={hits} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <section className="page-card">
        <h3>Family</h3>
        {mentioned.length === 0 ? (
          <p className="count">No one from the family tree is named on this page.</p>
        ) : (
          <ul className="page-family">
            {mentioned.map((person) => (
              <li key={person.id}>{person.name}</li>
            ))}
          </ul>
        )}
      </section>
      {showPrint ? (
        <section className="page-card page-sheet">
          <div className="page-card-head">
            <h3>Full text</h3>
            {english && english.language.toLowerCase() !== "english" ? (
              <div className="page-lang" role="group" aria-label="Language">
                <button type="button" className="page-edit" aria-pressed={!showEnglish} onClick={() => setShowEnglish(false)}>
                  Original
                </button>
                <button type="button" className="page-edit" aria-pressed={showEnglish} onClick={() => setShowEnglish(true)}>
                  English
                </button>
              </div>
            ) : (
              <button type="button" className="page-edit" onClick={() => void translate()} disabled={translating}>
                {translating ? "Translating" : "Translate"}
              </button>
            )}
          </div>
          {showEnglish && english ? <p className="count">Translated from {english.language}.</p> : null}
          {translateError ? <p className="notice">{translateError}</p> : null}
          {english && english.language.toLowerCase() === "english" && !translateError ? <p className="count">This page is already in English.</p> : null}
          <div className="page-print">
            {(showEnglish && english ? english.paragraphs : paragraphs).map((paragraph, index) => (
              <p key={index}>
                <Marked text={paragraph} people={people} />
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LeadDetail({ lead, hits }: { lead: PageLead; hits: PageHit[] | null }) {
  return (
    <div className="page-lead">
      <p>{lead.excerpt}</p>
      {lead.mapQuery ? (
        <a className="page-map" href={mapHref(lead.mapQuery)} target="_blank" rel="noreferrer">
          Open the map
        </a>
      ) : null}
      {hits && hits.length > 0 ? (
        <div className="page-also">
          <p className="page-cue">Also written on</p>
          <ul>
            {hits.map((hit) => (
              <li key={hit.filename}>
                <strong>{hit.filename}</strong>
                <span>{hit.excerpt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function citeWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function Marked({ text, people }: { text: string; people: Person[] }) {
  const marks = marksIn(text, people);
  if (marks.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  marks.forEach((mark, index) => {
    if (mark.start < cursor) return;
    if (mark.start > cursor) parts.push(text.slice(cursor, mark.start));
    parts.push(<mark key={`${mark.id}-${mark.start}-${index}`}>{text.slice(mark.start, mark.end)}</mark>);
    cursor = mark.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function PinRow({
  pin,
  people,
  pending,
  onEdit,
  onRemove,
}: {
  pin: PhotoPin;
  people: Person[];
  pending: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const person = people.find((item) => item.id === pin.personId);
  const role = person?.role === "daughter" || person?.role === "son" ? person.role : "";
  const parents = person?.parentNames ?? [];
  const siblings = person ? siblingsOf(person, people) : [];
  const family = parents.length > 0 || siblings.length > 0;
  return (
    <li>
      <div className="pin-head">
        <strong>{pin.label}</strong>
        <span className="pin-actions">
          <button type="button" onClick={onEdit} disabled={pending}>
            Edit
          </button>
          <button type="button" onClick={onRemove} disabled={pending}>
            Remove
          </button>
        </span>
      </div>
      {family ? (
        <div className="pin-kin">
          {parents.length > 0 ? (
            <div>
              <p className="pin-role">{role ? `${role} of` : "Parents"}</p>
              <ul className="pin-parents">
                {parents.map((parent) => (
                  <li key={parent}>
                    <PersonIcon />
                    <span>{parent}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {siblings.length > 0 ? (
            <div>
              <p className="pin-role">Siblings</p>
              <ul className="pin-parents">
                {siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <PersonIcon />
                    <span>{sibling.name}</span>
                    <em>{siblingLabel(sibling.role)}</em>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function siblingsOf(person: Person, people: Person[]): Person[] {
  const named = person.siblingNames ?? [];
  return people
    .filter(
      (other) =>
        other.id !== person.id &&
        (named.some((name) => sameName(name, other.name)) ||
          (person.parentNames.length > 0 && other.parentNames.some((name) => person.parentNames.some((parent) => sameName(parent, name))))),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function siblingLabel(role: Person["role"]): string {
  if (role === "son") return "Brother";
  if (role === "daughter") return "Sister";
  return "Sibling";
}

function PersonIcon() {
  return (
    <svg className="pin-parent-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.2 19.2c.9-3.1 3-4.6 5.8-4.6s4.9 1.5 5.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function mediaSrc(sourcePath: string, size: "thumb" | "full", rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}${turn}`;
}
