"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import type { GalleryImage } from "@/lib/library-view";
import { ITEM_TYPES, relationLine, sameName, type ItemTypeId, type Person, type PhotoPin, type PhotoRecord } from "@/lib/photo-types";

type LibraryPayload = {
  categories: string[];
  people: Person[];
  record: PhotoRecord;
  warning?: string;
  error?: string;
};

export function PhotoDetail({
  image,
  note,
  onClose,
  onSaved,
  onTagged,
}: {
  image: GalleryImage;
  note: string;
  onClose: () => void;
  onSaved: (note: string) => void;
  onTagged: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [categories, setCategories] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [record, setRecord] = useState<PhotoRecord | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<"person" | "thing">("person");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"" | "daughter" | "son">("");
  const [parentList, setParentList] = useState<string[]>([]);
  const [parentDraft, setParentDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState(note);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      })
      .catch(() => {
        if (!cancel) setError("The photo details could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, [image.sourcePath, note]);

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
  }, [image.sourcePath]);

  const known = people.find((person) => sameName(person.name, name));
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
      onTagged();
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

  function onPhotoClick(event: MouseEvent<HTMLImageElement>) {
    const stage = stageRef.current;
    if (!stage || !box.width || !box.height) return;
    const stageRect = stage.getBoundingClientRect();
    const x = (event.clientX - stageRect.left - box.left) / box.width;
    const y = (event.clientY - stageRect.top - box.top) / box.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    setEditingId(null);
    setDraft({ x, y });
    setKind("person");
    setName("");
    setRole("");
    setParentList([]);
    setParentDraft("");
    setError(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function addParent() {
    const next = parentDraft.trim().replace(/\s+/g, " ");
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
    const saved = await send(
      editingId
        ? { action: "edit", pinId: editingId, kind, name, role: showParents ? role : "", parents: showParents ? parentList : [] }
        : { action: "tag", x: draft?.x, y: draft?.y, kind, name, role: showParents ? role : "", parents: showParents ? parentList : [] },
    );
    if (saved) closeEditor();
  }

  const types = record?.types ?? [];
  const selectedCategories = record?.categories ?? [];
  const pins = record?.pins ?? [];

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.filename}>
      <button type="button" className="lightbox-backdrop" aria-label="Close photo" onClick={onClose} />
      <div className="lightbox-card">
        <div className="photo-stage" ref={stageRef}>
          <img ref={imageRef} src={mediaSrc(image.sourcePath, "full")} alt={image.filename} onClick={onPhotoClick} />
          {box.width > 0 ? (
            <div className="pin-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              {pins.map((pin) => (
                <span key={pin.id} className="pin" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>
                  <i />
                  <span>{pin.label}</span>
                </span>
              ))}
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

          <section className="tag-groups">
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
            ) : (
              <p className="count">No custom categories yet.</p>
            )}
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

          <section className="tag-groups">
            <h3>People and things</h3>
            <p className="count">Click a spot on the photo, then type a name. Add each parent separately.</p>
            {draft || editingId ? (
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
                <input
                  id="tag-name"
                  ref={nameRef}
                  list={kind === "person" ? "known-people" : undefined}
                  value={name}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    const match = people.find((person) => sameName(person.name, next));
                    if (match && !editingId) {
                      setRole(match.role);
                      setParentList(match.parentNames);
                    }
                  }}
                  placeholder={kind === "person" ? "Who is this?" : "What is this?"}
                  maxLength={80}
                />
                <datalist id="known-people">
                  {people.map((person) => (
                    <option key={person.id} value={person.name} />
                  ))}
                </datalist>
                {known && !editingId ? <p className="count">{relationLine(known) || "Already in the family tree."}</p> : null}
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
                        <input
                          value={parentDraft}
                          onChange={(event) => setParentDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            addParent();
                          }}
                          placeholder="Add a parent"
                          aria-label="Add a parent"
                          list="known-people"
                        />
                        <button type="button" onClick={addParent} disabled={parentDraft.trim().length === 0}>
                          Add parent
                        </button>
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
            {pins.length > 0 ? (
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
            ) : null}
            {people.length > 0 ? (
              <p className="count">
                {people.length === 1 ? "1 name saved for the family tree." : `${people.length} names saved for the family tree.`}
              </p>
            ) : null}
          </section>

          <form
            className="correction"
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
          {message ? <p className="count">{message}</p> : null}
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </div>
    </div>
  );
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
  const relation = person ? relationLine(person) : "";
  return (
    <li>
      <span>{relation || pin.label}</span>
      <span className="pin-actions">
        <button type="button" onClick={onEdit} disabled={pending}>
          Edit
        </button>
        <button type="button" onClick={onRemove} disabled={pending}>
          Remove
        </button>
      </span>
    </li>
  );
}

function mediaSrc(sourcePath: string, size: "thumb" | "full"): string {
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}`;
}
