"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { PhotoDetail } from "@/components/photo-detail";
import type { GalleryImage } from "@/lib/library-view";
import { familyNames, normalizeName } from "@/lib/photo-types";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "photo", label: "Photographs" },
  { id: "writing", label: "Letters and records" },
] as const;

type GalleryFilter = (typeof FILTERS)[number]["id"];

export function Gallery({ images }: { images: GalleryImage[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [family, setFamily] = useState("");
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(images.filter((image) => image.note).map((image) => [image.sourcePath, image.note])),
  );
  const [tagged, setTagged] = useState<Record<string, boolean>>(
    Object.fromEntries(images.filter((image) => image.tagged).map((image) => [image.sourcePath, true])),
  );
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(images.map((image) => [image.sourcePath, image.people])),
  );
  const [photoFamilies, setPhotoFamilies] = useState<Record<string, string[]>>(
    Object.fromEntries(images.map((image) => [image.sourcePath, image.families])),
  );
  const [turns, setTurns] = useState<Record<string, number>>({});

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return images;
    return images.filter((image) =>
      `${image.filename} ${image.capture} ${notes[image.sourcePath] ?? ""} ${names[image.sourcePath] ?? ""}`.toLowerCase().includes(needle),
    );
  }, [images, names, notes, query]);
  const inFamily = (image: GalleryImage) =>
    !family || (photoFamilies[image.sourcePath] ?? []).some((name) => normalizeName(name) === normalizeName(family));
  const inType = (image: GalleryImage) => filter === "all" || image.group === filter;
  const counts: Record<GalleryFilter, number> = {
    all: searched.filter(inFamily).length,
    photo: searched.filter((image) => image.group === "photo" && inFamily(image)).length,
    writing: searched.filter((image) => image.group === "writing" && inFamily(image)).length,
  };
  const familyChoices = useMemo(() => {
    const choices = new Map<string, string>();
    for (const namesForPhoto of Object.values(photoFamilies)) {
      for (const name of namesForPhoto) {
        const key = normalizeName(name);
        if (key && !choices.has(key)) choices.set(key, name);
      }
    }
    return [...choices.values()].sort((left, right) => left.localeCompare(right));
  }, [photoFamilies]);
  const familyCounts = Object.fromEntries(
    familyChoices.map((name) => [
      name,
      searched.filter((image) => inType(image) && (photoFamilies[image.sourcePath] ?? []).some((item) => normalizeName(item) === normalizeName(name))).length,
    ]),
  );
  const visible = searched.filter((image) => inType(image) && inFamily(image));

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setUploadNote("");
    let added = 0;
    let note = "";
    for (const file of files) {
      setUploadStatus(`Adding ${file.name}…`);
      const body = new FormData();
      body.set("file", file);
      try {
        const response = await fetch("/api/upload", { method: "POST", body });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; warning?: string; filename?: string };
        if (!response.ok) {
          throw new Error(payload.error || (response.status === 413 ? "That photo is too large to add here." : "The upload failed."));
        }
        added += 1;
        note = payload.warning || `Added ${payload.filename ?? file.name}.`;
      } catch (caught) {
        note = caught instanceof Error ? caught.message : "The upload failed.";
      }
    }
    setUploading(false);
    setUploadStatus("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
    setUploadNote(added > 0 && !note.startsWith("Added") ? note : added === 1 ? note : added > 1 ? `Added ${added} photos.` : note);
    if (added > 0) router.refresh();
  }

  return (
    <section>
      <form className="upload-form gallery-upload" onSubmit={onUpload}>
        <label className="file-picker">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,image/*"
            onChange={(event) => {
              setFiles([...(event.target.files ?? [])]);
              setUploadNote("");
            }}
          />
          <span>{files.length > 0 ? `${files.length} photo${files.length === 1 ? "" : "s"} selected` : "Choose photos"}</span>
        </label>
        <button type="submit" disabled={uploading || files.length === 0}>
          {uploading ? "Adding" : "Add to the gallery"}
        </button>
      </form>
      {uploadStatus ? <p className="count">{uploadStatus}</p> : null}
      {uploadNote ? <p className={uploadNote.startsWith("Added") ? "count" : "notice"}>{uploadNote}</p> : null}
      <div className="toolbar gallery-toolbar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people or photos"
          aria-label="Search people or photos"
          type="search"
        />
        <div className="filters" role="group" aria-label="Filter gallery">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label} {counts[item.id]}
            </button>
          ))}
          {familyChoices.length > 0 ? (
            <label className="family-filter">
              <select
                aria-label="Family"
                className={family ? "is-set" : undefined}
                value={family}
                onChange={(event) => setFamily(event.target.value)}
              >
                <option value="">All families</option>
                {familyChoices.map((name) => (
                  <option key={name} value={name}>
                    {name} · {familyCounts[name]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="empty-list">Nothing matches this view.</p>
      ) : (
        <ul className="gallery-grid">
          {visible.map((image) => (
            <li key={image.sourcePath}>
              <button type="button" aria-label={image.filename} onClick={() => setSelected(image)}>
                <img src={mediaSrc(image.sourcePath, "thumb", turns[image.sourcePath] ?? image.rotation)} alt={image.filename} loading="lazy" />
                {tagged[image.sourcePath] ? <span className="noted">Noted</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <PhotoDetail
          image={{ ...selected, rotation: turns[selected.sourcePath] ?? selected.rotation }}
          note={notes[selected.sourcePath] ?? ""}
          onClose={() => setSelected(null)}
          onSaved={(note) => setNotes((current) => ({ ...current, [selected.sourcePath]: note }))}
          onTurned={(rotation) => setTurns((current) => ({ ...current, [selected.sourcePath]: rotation }))}
          onTagged={(update) => {
            setTagged((current) => ({ ...current, [selected.sourcePath]: update.tagged }));
            setNames((current) => ({ ...current, [selected.sourcePath]: update.labels.join(" ") }));
            setPhotoFamilies((current) => ({
              ...current,
              [selected.sourcePath]: [
                ...new Map(update.labels.flatMap((label) => familyNames(label).map((name) => [normalizeName(name), name] as const))).values(),
              ],
            }));
          }}
        />
      ) : null}
    </section>
  );
}

function mediaSrc(sourcePath: string, size: "thumb" | "full", rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}${turn}`;
}
