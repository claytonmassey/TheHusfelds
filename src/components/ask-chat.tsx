"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import type { Correction } from "@/lib/corrections";
import { pageParagraphs } from "@/lib/page-text";

type Source = {
  filename: string;
  capture: string;
  score: number;
  sourcePath: string;
  kind: string;
  excerpt: string;
};

type Followup = {
  label: string;
  question: string;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  followups?: Followup[];
};

export function AskChat({ initialCorrections }: { initialCorrections: Correction[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState(initialCorrections);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [correction, setCorrection] = useState("");
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<Source | null>(null);

  async function ask(question: string) {
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next);
    setDraft("");
    setPending(true);
    setError(null);
    setSource(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const payload = (await response.json()) as { answer?: string; sources?: Source[]; followups?: Followup[]; error?: string };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "The question failed.");
      }
      setTurns([
        ...next,
        { role: "assistant", content: payload.answer, sources: payload.sources ?? [], followups: payload.followups ?? [] },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The question failed.");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;
    void ask(question);
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>, turn: Turn) {
    event.preventDefault();
    const statement = correction.trim();
    if (!statement || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement, replaced: turn.content }),
      });
      const payload = (await response.json()) as { correction?: Correction; error?: string };
      if (!response.ok || !payload.correction) {
        throw new Error(payload.error || "The correction could not be saved.");
      }
      setMemory((current) => [...current, payload.correction as Correction]);
      setCorrecting(null);
      setCorrection("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The correction could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="chat">
      {memory.length > 0 ? (
        <aside className="memory" aria-label="Corrected facts">
          <h2>Remembered corrections</h2>
          <ul>
            {memory.map((item) => (
              <li key={item.id}>{item.statement}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="thread" aria-live="polite">
        {turns.length === 0 ? (
          <p className="empty-list">Ask about a name, a place, or a date from the papers.</p>
        ) : (
          turns.map((turn, index) => (
            <article key={`${turn.role}-${index}`} className={`bubble ${turn.role}`}>
              <p>{turn.content}</p>
              {turn.sources && turn.sources.length > 0 ? (
                <div className="sources">
                  {turn.sources.map((item, sourceIndex) => (
                    <button type="button" key={`${item.sourcePath || item.filename}-${sourceIndex}`} onClick={() => setSource(item)}>
                      {item.filename}
                    </button>
                  ))}
                </div>
              ) : null}
              {turn.followups && turn.followups.length > 0 ? (
                <div className="followups">
                  <p>Would you like to learn more?</p>
                  {turn.followups.map((item) => (
                    <button type="button" key={item.question} disabled={pending} onClick={() => void ask(item.question)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {turn.role === "assistant" ? (
                correcting === index ? (
                  <form className="correction" onSubmit={(event) => saveCorrection(event, turn)}>
                    <label htmlFor={`correction-${index}`}>Correct this</label>
                    <textarea
                      id={`correction-${index}`}
                      value={correction}
                      onChange={(event) => setCorrection(event.target.value)}
                      placeholder="Brenda is the daughter of Mazie."
                      rows={2}
                    />
                    <div className="correction-actions">
                      <button type="submit" disabled={saving || correction.trim().length === 0}>
                        {saving ? "Saving" : "Save correction"}
                      </button>
                      <button type="button" onClick={() => setCorrecting(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="correct" onClick={() => {
                    setCorrecting(index);
                    setCorrection("");
                  }}>
                    Correct
                  </button>
                )
              ) : null}
            </article>
          ))
        )}
        {pending ? <p className="count">Reading the indexed pages…</p> : null}
        {error ? <p className="notice">{error}</p> : null}
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What do the papers say?"
          aria-label="Question"
          rows={2}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={pending || draft.trim().length === 0}>
          {pending ? "Asking" : "Ask"}
        </button>
      </form>
      {source ? <SourceView source={source} onClose={() => setSource(null)} /> : null}
    </section>
  );
}

function SourceView({ source, onClose }: { source: Source; onClose: () => void }) {
  const [text, setText] = useState(source.excerpt);
  const [ready, setReady] = useState(false);
  const image = source.kind === "IMAGE" || /\.(hei[cf]|png|jpe?g|gif|webp|tiff?)$/i.test(source.filename);
  const path = source.sourcePath || source.filename;

  useEffect(() => {
    let cancel = false;
    setText(source.excerpt);
    setReady(false);
    fetch(`/api/photo-record?path=${encodeURIComponent(path)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ text?: string }>)
      .then((payload) => {
        if (!cancel && payload.text?.trim()) setText(payload.text);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [path, source.excerpt]);

  const paragraphs = pageParagraphs(text);

  return createPortal(
    <div className="draft-link" role="dialog" aria-modal="true" aria-label={source.filename}>
      <button type="button" className="lightbox-backdrop" aria-label="Close" onClick={onClose} />
      <div className="draft-link-card source-view">
        <div className="lightbox-heading">
          <h2>{source.filename}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {image ? <img src={`/api/media?size=full&path=${encodeURIComponent(path)}`} alt={source.filename} /> : <p className="count">Video</p>}
        <section className="page-card">
          <h3>{image ? "From this page" : "From this video"}</h3>
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
          ) : (
            <p className="count">{ready ? "No writing was found on this page." : "Reading the page…"}</p>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
