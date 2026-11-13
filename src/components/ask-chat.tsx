"use client";

import { useState, type FormEvent } from "react";

import type { Correction } from "@/lib/corrections";

type Source = {
  filename: string;
  capture: string;
  score: number;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;

    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const payload = (await response.json()) as { answer?: string; sources?: Source[]; error?: string };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "The question failed.");
      }
      setTurns([...next, { role: "assistant", content: payload.answer, sources: payload.sources ?? [] }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The question failed.");
    } finally {
      setPending(false);
    }
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
                  {turn.sources.map((source) => (
                    <span key={`${source.filename}-${source.score}`}>{source.filename}</span>
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
    </section>
  );
}
