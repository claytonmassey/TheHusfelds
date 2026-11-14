"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { UploadDocuments } from "@/components/upload-documents";
import type { KnowledgeItem } from "@/lib/library-view";

export function KnowledgeRepo({ items }: { items: KnowledgeItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [gone, setGone] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const hidden = useMemo(() => new Set(gone), [gone]);
  const visible = items.filter((item) => {
    if (hidden.has(item.sourcePath)) return false;
    if (!needle) return true;
    return `${item.filename} ${item.label} ${item.summary}`.toLowerCase().includes(needle);
  });

  async function remove(sourcePath: string) {
    setBusy(sourcePath);
    setError(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "That document could not be removed.");
      setGone((current) => [...current, sourcePath]);
      setConfirming(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That document could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="knowledge">
      <UploadDocuments onAdded={() => router.refresh()} />
      <div className="knowledge-tools">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents"
          aria-label="Search documents"
          type="search"
        />
        <p className="count">
          {visible.length} document{visible.length === 1 ? "" : "s"}
        </p>
      </div>
      {error ? <p className="notice">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="empty-list">{items.length === 0 || hidden.size === items.length ? "No documents yet." : "Nothing matches this search."}</p>
      ) : (
        <ul className="knowledge-list">
          {visible.map((item) => (
            <li key={item.sourcePath} className="knowledge-card">
              <div className="knowledge-thumb">
                {item.thumb ? (
                  <img src={`/api/media?size=thumb&path=${encodeURIComponent(item.sourcePath)}`} alt="" loading="lazy" />
                ) : (
                  <span className="doc-mark">{item.extension.toUpperCase() || "FILE"}</span>
                )}
                <span className="knowledge-kind">{item.label}</span>
              </div>
              <div>
                <h2>{item.filename}</h2>
                {item.scanned && item.summary ? <p className="upload-preview">{item.summary}</p> : null}
                {confirming === item.sourcePath ? (
                  <div className="knowledge-actions">
                    <button type="button" onClick={() => void remove(item.sourcePath)} disabled={busy === item.sourcePath}>
                      {busy === item.sourcePath ? "Removing" : "Remove"}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} disabled={busy === item.sourcePath}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="knowledge-actions">
                    <button type="button" onClick={() => setConfirming(item.sourcePath)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
