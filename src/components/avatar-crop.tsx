"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { Person, PersonAvatar } from "@/lib/photo-types";

export type AvatarPhoto = {
  sourcePath: string;
  rotation: number;
  personIds: string[];
};

type CropBox = { x: number; y: number; w: number; h: number };

export function AvatarCrop({
  person,
  photos,
  onSaved,
}: {
  person: Person;
  photos: AvatarPhoto[];
  onSaved: (people: Person[]) => void;
}) {
  const theirs = photos.filter((photo) => photo.personIds.includes(person.id));
  const [path, setPath] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<((event: PointerEvent) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (dragRef.current) window.removeEventListener("pointermove", dragRef.current);
    };
  }, []);

  const selected = theirs.find((photo) => photo.sourcePath === path);

  function choose(next: string) {
    setPath(next);
    setError(null);
    setCrop(person.avatar?.sourcePath === next ? { x: person.avatar.x, y: person.avatar.y, w: person.avatar.w, h: person.avatar.h } : null);
  }

  function placeDefault(image: HTMLImageElement) {
    if (crop && path === person.avatar?.sourcePath) return;
    const width = image.naturalWidth || 1;
    const height = image.naturalHeight || 1;
    const side = Math.min(width, height) * 0.72;
    const w = side / width;
    const h = side / height;
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }

  function track(event: ReactPointerEvent, resize: boolean) {
    const image = imgRef.current;
    const box = crop;
    if (!image || !box) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = image.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, box };
    const move = (pointer: PointerEvent) => {
      if (resize) {
        const side = Math.min(
          Math.max(64, origin.box.w * rect.width + (pointer.clientX - origin.x)),
          rect.width - origin.box.x * rect.width,
          rect.height - origin.box.y * rect.height,
        );
        setCrop({ x: origin.box.x, y: origin.box.y, w: side / rect.width, h: side / rect.height });
        return;
      }
      const dx = (pointer.clientX - origin.x) / rect.width;
      const dy = (pointer.clientY - origin.y) / rect.height;
      setCrop({
        ...origin.box,
        x: clamp(origin.box.x + dx, 0, 1 - origin.box.w),
        y: clamp(origin.box.y + dy, 0, 1 - origin.box.h),
      });
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    dragRef.current = move;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  async function save(next: PersonAvatar | null) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "avatar", id: person.id, avatar: next }),
      });
      const payload = (await response.json()) as { people?: Person[]; error?: string };
      if (!response.ok || !payload.people) throw new Error(payload.error || "That could not be saved.");
      onSaved(payload.people);
      setPath(null);
      setCrop(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const turn = person.avatar ? (photos.find((photo) => photo.sourcePath === person.avatar?.sourcePath)?.rotation ?? 0) : 0;

  return (
    <section className="avatar-edit">
      <label className="family-label">Avatar</label>
      <div className="avatar-edit-current">
        {person.avatar ? <img src={avatarSrc(person.avatar, turn)} alt="" /> : <span>{initials(person.name)}</span>}
      </div>
        {theirs.length === 0 ? <p className="empty-list">Tag {person.name} in a photo before choosing a crop.</p> : null}
        {theirs.length > 0 && !selected ? (
          <ul className="crop-photos">
            {theirs.map((photo) => (
              <li key={photo.sourcePath}>
                <button type="button" onClick={() => choose(photo.sourcePath)} aria-label={`Crop ${photo.sourcePath}`}>
                  <img src={mediaSrc(photo.sourcePath, "thumb", photo.rotation)} alt="" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selected ? (
          <div className="crop-work">
            <div className="crop-stage">
              <div className="crop-frame">
                <img
                  ref={imgRef}
                  src={mediaSrc(selected.sourcePath, "full", selected.rotation)}
                  alt=""
                  onLoad={(event) => placeDefault(event.currentTarget)}
                />
                {crop ? (
                  <div
                    className="crop-box"
                    style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                    onPointerDown={(event) => track(event, false)}
                  >
                    <span className="crop-handle" onPointerDown={(event) => track(event, true)} />
                  </div>
                ) : null}
              </div>
            </div>
            <p className="crop-hint">Drag the square. Drag the corner to change its size.</p>
            <div className="crop-actions">
              <button type="button" onClick={() => setPath(null)}>
                All photos
              </button>
              {person.avatar ? (
                <button type="button" onClick={() => save(null)} disabled={pending}>
                  Remove
                </button>
              ) : null}
              <button type="button" className="crop-save" onClick={() => crop && save({ sourcePath: selected.sourcePath, ...crop })} disabled={pending || !crop}>
                {pending ? "Saving…" : "Use crop"}
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="notice">{error}</p> : null}
    </section>
  );
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

function mediaSrc(sourcePath: string, size: "thumb" | "full", rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}${turn}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
