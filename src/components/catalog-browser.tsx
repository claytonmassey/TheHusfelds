"use client";

import { useMemo, useState } from "react";

import { formatBytes, formatDuration, hasKind, type CatalogCapture, type CatalogFile } from "@/lib/catalog";

type Filter = "all" | "live" | "stills";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live photos" },
  { id: "stills", label: "Stills" },
];

export function CatalogBrowser({ catalog }: { catalog: CatalogFile }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.captures.filter((capture) => {
      if (filter === "live" && !isLive(capture)) return false;
      if (filter === "stills" && !isStill(capture)) return false;
      if (!needle) return true;
      const haystack = [capture.basename, ...capture.assets.map((asset) => asset.filename)].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [catalog.captures, filter, query]);

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search captures"
          aria-label="Search captures"
          type="search"
        />
        <div className="filters" role="group" aria-label="Filter captures">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className="count">
        Showing {visible.length} of {catalog.stats.captures}
        {catalog.stats.uploaded > 0 ? ` · ${catalog.stats.uploaded} files in Blob` : ""}
      </p>
      {visible.length === 0 ? (
        <p className="empty-list">No captures match this view.</p>
      ) : (
        <ol className="captures">
          {visible.map((capture) => (
            <li key={capture.basename} className="capture">
              <div>
                <h2>{capture.basename}</h2>
                <time dateTime={capture.capturedAt ?? undefined}>{formatWhen(capture.capturedAt)}</time>
                <p className="files">{capture.assets.map((asset) => asset.filename).join(" · ")}</p>
              </div>
              <dl className="facts">
                <div>
                  <dt>Still</dt>
                  <dd>{stillLabel(capture)}</dd>
                </div>
                <div>
                  <dt>Motion</dt>
                  <dd>{motionLabel(capture)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(capture.assets.reduce((total, asset) => total + asset.byteSize, 0))}</dd>
                </div>
              </dl>
              <span className={statusClass(capture)}>{statusLabel(capture)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function isLive(capture: CatalogCapture): boolean {
  return hasKind(capture, "IMAGE") && hasKind(capture, "VIDEO");
}

function isStill(capture: CatalogCapture): boolean {
  return hasKind(capture, "IMAGE") && !hasKind(capture, "VIDEO");
}

function stillLabel(capture: CatalogCapture): string {
  const image = capture.assets.find((asset) => asset.kind === "IMAGE");
  if (!image) return "—";
  if (image.width && image.height) return `${image.width} × ${image.height}`;
  return image.extension.toUpperCase();
}

function motionLabel(capture: CatalogCapture): string {
  const video = capture.assets.find((asset) => asset.kind === "VIDEO");
  if (!video) return "—";
  const duration = formatDuration(video.durationMs);
  if (video.width && video.height) return `${duration} · ${video.width} × ${video.height}`;
  return duration;
}

function statusLabel(capture: CatalogCapture): string {
  if (capture.assets.some((asset) => asset.status === "FAILED")) return "Failed";
  if (capture.assets.length > 0 && capture.assets.every((asset) => asset.status === "UPLOADED")) return "In Blob";
  return "Cataloged";
}

function statusClass(capture: CatalogCapture): string {
  const label = statusLabel(capture);
  if (label === "Failed") return "status failed";
  if (label === "In Blob") return "status stored";
  return "status";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
