"use client";

import { useMemo, useState } from "react";

import { PhotoDetail } from "@/components/photo-detail";
import type { GalleryImage } from "@/lib/library-view";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "photo", label: "Photographs" },
  { id: "writing", label: "Letters and records" },
] as const;

type GalleryFilter = (typeof FILTERS)[number]["id"];

export function Gallery({ images }: { images: GalleryImage[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(images.filter((image) => image.note).map((image) => [image.sourcePath, image.note])),
  );
  const [tagged, setTagged] = useState<Record<string, boolean>>(
    Object.fromEntries(images.filter((image) => image.tagged).map((image) => [image.sourcePath, true])),
  );

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return images;
    return images.filter((image) => `${image.filename} ${image.capture} ${notes[image.sourcePath] ?? ""}`.toLowerCase().includes(needle));
  }, [images, notes, query]);
  const counts: Record<GalleryFilter, number> = {
    all: searched.length,
    photo: searched.filter((image) => image.group === "photo").length,
    writing: searched.filter((image) => image.group === "writing").length,
  };
  const visible = filter === "all" ? searched : searched.filter((image) => image.group === filter);

  return (
    <section>
      <div className="toolbar gallery-toolbar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the gallery"
          aria-label="Search the gallery"
          type="search"
        />
        <div className="filters" role="group" aria-label="Filter gallery">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label} {counts[item.id]}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="empty-list">Nothing matches this view.</p>
      ) : (
        <ul className="gallery-grid">
          {visible.map((image) => (
            <li key={image.sourcePath}>
              <button type="button" aria-label={image.filename} onClick={() => setSelected(image)}>
                <img src={mediaSrc(image.sourcePath, "thumb")} alt={image.filename} loading="lazy" />
                {tagged[image.sourcePath] ? <span className="noted">Noted</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <PhotoDetail
          image={selected}
          note={notes[selected.sourcePath] ?? ""}
          onClose={() => setSelected(null)}
          onSaved={(note) => setNotes((current) => ({ ...current, [selected.sourcePath]: note }))}
          onTagged={() => setTagged((current) => ({ ...current, [selected.sourcePath]: true }))}
        />
      ) : null}
    </section>
  );
}

function mediaSrc(sourcePath: string, size: "thumb" | "full"): string {
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}`;
}
