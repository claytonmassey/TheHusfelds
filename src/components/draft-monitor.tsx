"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NameSearch } from "@/components/name-search";
import { childRows, draftRows, familyCards, formatBorn, type DraftRow } from "@/lib/draft-view";
import type { FamilyDraft } from "@/lib/family-draft";
import type { KnownName } from "@/lib/known-name";
import { sameName } from "@/lib/photo-types";

export function DraftMonitor() {
  const [draft, setDraft] = useState<FamilyDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"start" | "apply" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<KnownName[]>([]);
  const fetchGen = useRef(0);
  const scanning = draft?.state === "running";

  useEffect(() => {
    let cancel = false;
    let timer = 0;
    const tick = async () => {
      const gen = fetchGen.current;
      try {
        const payload = (await fetch("/api/draft").then((response) => response.json())) as FamilyDraft;
        if (cancel || gen !== fetchGen.current) return;
        setDraft(payload);
        if (payload.state === "running") timer = window.setTimeout(() => void tick(), 1500);
      } catch {
        if (!cancel) timer = window.setTimeout(() => void tick(), 3000);
      }
    };
    void tick();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [scanning]);

  function acceptDraft(payload: FamilyDraft) {
    fetchGen.current += 1;
    setDraft(payload);
    void fetch("/api/names", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ names?: KnownName[] }>)
      .then((body) => {
        if (Array.isArray(body.names)) setRoster(body.names);
      })
      .catch(() => undefined);
  }

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

  async function start() {
    setPending("start");
    setError(null);
    setConfirming(false);
    try {
      const payload = (await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }).then((response) => response.json())) as FamilyDraft & { error?: string };
      if (payload.error) setError(payload.error);
      else setDraft({ ...payload, state: "running" });
    } catch {
      setError("The scan could not be started.");
    } finally {
      setPending(null);
    }
  }

  async function apply() {
    setPending("apply");
    setError(null);
    try {
      const response = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply" }) });
      const payload = (await response.json()) as FamilyDraft & { error?: string };
      if (!response.ok || payload.error) setError(payload.error || "The draft could not be added.");
      else {
        setDraft(payload);
        setConfirming(false);
      }
    } catch {
      setError("The draft could not be added.");
    } finally {
      setPending(null);
    }
  }

  const rows = useMemo(() => {
    const extracted = (draft?.people ?? []).map((person) => ({
      name: person.name,
      role: person.role,
      parentNames: person.parentNames,
      siblingNames: person.siblingNames,
      wifeName: person.wifeName,
      born: person.born,
      where: "draft" as const,
      draftId: person.id,
    }));
    const added = roster
      .filter((item) => item.liveId)
      .map((item) => ({
        name: item.name,
        role: item.role,
        parentNames: item.parentNames,
        siblingNames: item.siblingNames,
        wifeName: item.wifeName,
        born: item.born,
        where: "family" as const,
        liveId: item.liveId,
        draftId: item.draftId,
      }));
    return draftRows([...extracted, ...added]);
  }, [draft, roster]);

  const options = useMemo<KnownName[]>(
    () =>
      rows.map((row) => ({
        name: row.name,
        role: row.role,
        parentNames: row.parentNames,
        siblingNames: row.siblingNames,
        wifeName: row.wifeName,
        born: row.born,
        where: row.liveId ? "family" : "draft",
        draftId: row.draftId,
        liveId: row.liveId,
      })),
    [rows],
  );

  return (
    <section className="draft-monitor">
      <div className="draft-status">
        <div className="draft-actions">
          <button type="button" onClick={() => void start()} disabled={pending !== null || draft?.state === "running"}>
            {draft?.state === "running" || pending === "start" ? "Scanning" : draft?.people.length ? "Scan again" : "Scan the papers"}
          </button>
          {draft && draft.people.length > 0 ? (
            confirming && draft.state !== "running" ? (
              <button type="button" className="is-primary" onClick={() => void apply()} disabled={pending === "apply"}>
                {pending === "apply" ? "Adding" : "Add them to the family"}
              </button>
            ) : (
              <button type="button" className="is-primary" onClick={() => setConfirming(true)} disabled={draft.state === "running" || pending !== null}>
                Apply to the family
              </button>
            )
          ) : null}
        </div>
        {confirming ? <p className="count">Existing parents and dates stay as they are. Empty places get filled from this draft.</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {draft?.appliedAt ? <p className="count">Last added {draft.added} people and updated {draft.updated}.</p> : null}
      </div>
      {rows.length > 0 ? <DraftBoard rows={rows} selectedKey={selectedKey} onOpen={setSelectedKey} /> : null}
      <LinkSheet
        person={rows.find((item) => item.key === selectedKey) ?? null}
        rows={rows}
        options={options}
        onOpen={setSelectedKey}
        onClose={() => setSelectedKey(null)}
        onSaved={acceptDraft}
      />
    </section>
  );
}

function DraftBoard({ rows, selectedKey, onOpen }: { rows: DraftRow[]; selectedKey: string | null; onOpen: (key: string) => void }) {
  const cards = useMemo(() => familyCards(rows), [rows]);
  return (
    <div className="draft-board">
      <PeopleList rows={rows} selectedKey={selectedKey} onOpen={onOpen} />
      <section className="draft-structures">
        <header>
          <h2>Families</h2>
          <p>Each household, then the households of its children. A child with a birth date comes first.</p>
        </header>
        <div className="draft-families">
          {cards.map((card) => (
            <article key={card.id} className="draft-family">
              <div className="household-parents">
                {card.parents.map((name) => (
                  <RowName key={name} name={name} rows={rows} onOpen={onOpen} kind="parent" />
                ))}
              </div>
              <ul>
                {card.children.map((child) => (
                  <li key={child.key}>
                    <RowName
                      name={child.name}
                      rows={rows}
                      onOpen={onOpen}
                      kind="child"
                      role={child.role}
                      detail={[child.role, child.born ? formatBorn(child.born) : ""].filter(Boolean).join(" · ")}
                    />
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PeopleList({ rows, selectedKey, onOpen }: { rows: DraftRow[]; selectedKey: string | null; onOpen: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLUListElement>(null);
  const [windowed, setWindowed] = useState({ start: 0, end: 40 });
  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    setWindowed({ start: 0, end: 40 });
  }, [needle]);

  useEffect(() => {
    const list = scroller.current;
    if (!list) return;
    const update = () => {
      const item = 56;
      const start = Math.max(0, Math.floor(list.scrollTop / item) - 8);
      const end = Math.min(visible.length, start + Math.ceil(list.clientHeight / item) + 16);
      setWindowed((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => {
      list.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [visible.length]);

  return (
    <section className="draft-roster">
      <header>
        <h2>People</h2>
        <p>{rows.length} names. Click one to edit.</p>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            scroller.current?.scrollTo(0, 0);
          }}
          placeholder="Search names"
          aria-label="Search names"
        />
      </header>
      <ul ref={scroller}>
        <li className="draft-spacer" style={{ height: windowed.start * 56 }} aria-hidden="true" />
        {visible.slice(windowed.start, windowed.end).map((row) => (
          <li key={row.key}>
            <button type="button" className={row.key === selectedKey ? "is-selected" : undefined} onClick={() => onOpen(row.key)}>
              <strong>{row.name}</strong>
              <span>{rowLine(row)}</span>
            </button>
          </li>
        ))}
        <li className="draft-spacer" style={{ height: Math.max(0, visible.length - windowed.end) * 56 }} aria-hidden="true" />
      </ul>
    </section>
  );
}

function RowName({
  name,
  rows,
  onOpen,
  kind = "child",
  role = "",
  detail = "",
}: {
  name: string;
  rows: DraftRow[];
  onOpen: (key: string) => void;
  kind?: "parent" | "child";
  role?: string;
  detail?: string;
}) {
  const match = rows.find((row) => sameName(row.name, name));
  const label = match?.name ?? name;
  const open = match ? () => onOpen(match.key) : undefined;
  if (kind === "parent") {
    return (
      <button type="button" className="household-parent" onClick={open} disabled={!open} aria-label={`${label}, parent`}>
        <ParentIcon />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <button type="button" className="household-child" onClick={open} disabled={!open} aria-label={detail ? `${label}, ${detail}` : label}>
      <RoleIcon role={role} />
      <span>
        <strong>{label}</strong>
        {detail ? <em>{detail}</em> : null}
      </span>
    </button>
  );
}

function ParentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="3.2" fill="currentColor" />
      <path d="M5.2 19.6c1.1-3.6 3.6-5.3 6.8-5.3s5.7 1.7 6.8 5.3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

function RoleIcon({ role }: { role: string }) {
  if (role === "daughter") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5.8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 9.4 6.2 20.2h11.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  if (role === "son") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5.8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <rect x="7.4" y="10.2" width="9.2" height="9.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.2 19.2c.8-2.5 2.5-3.8 4.8-3.8s4 1.3 4.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function rowLine(row: DraftRow): string {
  const bits = [row.born ? formatBorn(row.born) : "", row.where === "draft" ? "From the papers" : "In the family"];
  return bits.filter(Boolean).join(" · ");
}

function LinkSheet({
  person,
  rows,
  options,
  onOpen,
  onClose,
  onSaved,
}: {
  person: DraftRow | null;
  rows: DraftRow[];
  options: KnownName[];
  onOpen: (key: string) => void;
  onClose: () => void;
  onSaved: (draft: FamilyDraft) => void;
}) {
  const [role, setRole] = useState<"" | "daughter" | "son">(person?.role ?? "");
  const [parents, setParents] = useState<string[]>(person?.parentNames ?? []);
  const [siblings, setSiblings] = useState<string[]>(person?.siblingNames ?? []);
  const [wife, setWife] = useState(person?.wifeName ?? "");
  const [born, setBorn] = useState(person?.born ?? "");
  const [children, setChildren] = useState<Array<{ name: string; role: "daughter" | "son" }>>([]);
  const [parentDraft, setParentDraft] = useState("");
  const [siblingDraft, setSiblingDraft] = useState("");
  const [childDraft, setChildDraft] = useState("");
  const [childRole, setChildRole] = useState<"" | "daughter" | "son">("");
  const [combineWith, setCombineWith] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!person) return;
    setRole(person.role);
    setParents(person.parentNames);
    setSiblings(person.siblingNames);
    setWife(person.wifeName);
    setBorn(person.born);
    setChildren(
      childRows(person, rows)
        .filter((item): item is DraftRow & { role: "daughter" | "son" } => item.role === "daughter" || item.role === "son")
        .map((item) => ({ name: item.name, role: item.role })),
    );
    setParentDraft("");
    setSiblingDraft("");
    setChildDraft("");
    setChildRole("");
    setCombineWith("");
    setError(null);
    setSaved("");
  }, [person?.key]);

  useEffect(() => {
    if (!formKey || !person) return;
    setRole(person.role);
    setParents(person.parentNames);
    setSiblings(person.siblingNames);
    setWife(person.wifeName);
    setBorn(person.born);
    setChildren(
      childRows(person, rows)
        .filter((item): item is DraftRow & { role: "daughter" | "son" } => item.role === "daughter" || item.role === "son")
        .map((item) => ({ name: item.name, role: item.role })),
    );
    setParentDraft("");
    setSiblingDraft("");
    setChildDraft("");
    setChildRole("");
    setCombineWith("");
    setError(null);
    setSaved("Combined into one person.");
  }, [formKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!person) return null;

  function addName(current: string[], value: string, limit: number): string[] | null {
    const name = value.replace(/\s+/g, " ").trim();
    if (!name) return current;
    if (sameName(name, person?.name ?? "")) return null;
    if (current.some((item) => sameName(item, name)) || current.length >= limit) return current;
    return [...current, name];
  }

  async function save() {
    const nextParents = addName(parents, parentDraft, 4);
    const nextSiblings = addName(siblings, siblingDraft, 8);
    if (!nextParents || !nextSiblings) {
      setError("A person cannot be their own parent or sibling.");
      return;
    }
    const pendingChild = childDraft.replace(/\s+/g, " ").trim();
    let nextChildren = children;
    if (pendingChild) {
      if (!childRole) {
        setError("Choose daughter or son, and name the child.");
        return;
      }
      if (sameName(pendingChild, person?.name ?? "") || nextParents.some((parent) => sameName(parent, pendingChild)) || sameName(pendingChild, wife)) {
        setError("A child cannot be the same person, a parent, or a spouse.");
        return;
      }
      if (!nextChildren.some((item) => sameName(item.name, pendingChild))) nextChildren = [...nextChildren, { name: pendingChild, role: childRole }];
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          id: person?.draftId,
          name: person?.name,
          role: nextParents.length > 0 ? role : "",
          parents: nextParents,
          siblings: nextSiblings.filter((name) => !nextParents.some((parent) => sameName(parent, name)) && !sameName(name, wife)),
          wife,
          born,
          children: nextChildren,
        }),
      });
      const payload = (await response.json()) as FamilyDraft & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Those links could not be saved.");
      onSaved(payload);
      setChildren(nextChildren);
      setSaved("Saved to the family.");
      setParentDraft("");
      setSiblingDraft("");
      setChildDraft("");
      setChildRole("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those links could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function combine() {
    const other = combineWith.replace(/\s+/g, " ").trim();
    if (!other) {
      setError("Choose a person to combine with.");
      return;
    }
    if (sameName(other, person?.name ?? "")) {
      setError("Choose a different person.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "combine", name: person?.name, with: other }),
      });
      const payload = (await response.json()) as FamilyDraft & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Those names could not be combined.");
      onSaved(payload);
      setFormKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those names could not be combined.");
    } finally {
      setPending(false);
    }
  }

  if (!person || !mounted) return null;

  return createPortal(
    <div className="draft-link" role="dialog" aria-modal="true" aria-label={person.name}>
      <button type="button" className="lightbox-backdrop" aria-label="Close" onClick={onClose} />
      <form
        className="draft-link-card correction"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="lightbox-heading">
          <h2>{person.name}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="draft-note">Saving puts this person on the family tree, so it stays when you leave.</p>
        <div className="editor-grid">
          <section className="editor-section">
            <header className="editor-head">
              <h3>This person</h3>
              <p>Birth date, and whether they are a daughter or a son.</p>
            </header>
            <div className="editor-person-row">
              <div>
                <label className="editor-kicker" htmlFor="draft-born">
                  Born
                </label>
                <input id="draft-born" type="date" value={born} onChange={(event) => setBorn(event.target.value)} />
              </div>
              <div>
                <span className="editor-kicker">Daughter or son</span>
                <div className="choice" role="group" aria-label="Daughter or son">
                  <button type="button" aria-pressed={role === "daughter"} onClick={() => setRole(role === "daughter" ? "" : "daughter")}>
                    Daughter
                  </button>
                  <button type="button" aria-pressed={role === "son"} onClick={() => setRole(role === "son" ? "" : "son")}>
                    Son
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section className="editor-section">
            <header className="editor-head">
              <h3>Spouse</h3>
              <p>The person they married.</p>
            </header>
            <NameSearch mode="field" id="draft-spouse" label="Search for a spouse" value={wife} options={options} exclude={[person.name, ...parents, ...siblings]} onChange={setWife} />
          </section>
          <LinkField
            label="Parents"
            hint="Who this person is the child of."
            names={parents}
            rows={rows}
            options={options}
            draft={parentDraft}
            placeholder="Search parents"
            exclude={[person.name, ...parents]}
            onOpen={onOpen}
            onDraft={setParentDraft}
            onRemove={(name) => setParents((current) => current.filter((item) => !sameName(item, name)))}
            onAdd={(picked) => {
              const next = addName(parents, picked, 4);
              if (!next) {
                setError("A person cannot be their own parent.");
                return;
              }
              setError(null);
              setParents(next);
              setParentDraft("");
            }}
          />
          <LinkField
            label="Siblings"
            hint="Brothers and sisters."
            names={siblings}
            rows={rows}
            options={options}
            draft={siblingDraft}
            placeholder="Search siblings"
            exclude={[person.name, ...parents, ...siblings, wife]}
            onOpen={onOpen}
            onDraft={setSiblingDraft}
            onRemove={(name) => setSiblings((current) => current.filter((item) => !sameName(item, name)))}
            onAdd={(picked) => {
              const next = addName(siblings, picked, 8);
              if (!next) {
                setError("A person cannot be their own sibling.");
                return;
              }
              setError(null);
              setSiblings(next.filter((name) => !parents.some((parent) => sameName(parent, name))));
              setSiblingDraft("");
            }}
          />
          <section className="editor-section editor-wide">
            <header className="editor-head">
              <h3>Children</h3>
              <p>Their daughters and sons. Search for the child, then choose daughter or son.</p>
            </header>
            {children.length > 0 ? (
              <ul className="parent-chips">
                {children.map((child) => (
                  <li key={child.name}>
                    <RowName name={child.name} rows={rows} onOpen={onOpen} role={child.role} />
                    <span>{child.role}</span>
                    <button type="button" aria-label={`Remove ${child.name}`} onClick={() => setChildren((current) => current.filter((item) => !sameName(item.name, child.name)))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="draft-note">None yet.</p>
            )}
            <div className="editor-add">
              <NameSearch mode="field" label="Search children" value={childDraft} options={options} exclude={[person.name, ...parents, wife, ...children.map((child) => child.name)]} onChange={setChildDraft} />
              <div className="editor-child-role">
                <span className="editor-kicker">Add as</span>
                <div className="choice" role="group" aria-label="Child is a daughter or son">
                  <button type="button" aria-pressed={childRole === "daughter"} onClick={() => setChildRole(childRole === "daughter" ? "" : "daughter")}>
                    Daughter
                  </button>
                  <button type="button" aria-pressed={childRole === "son"} onClick={() => setChildRole(childRole === "son" ? "" : "son")}>
                    Son
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const name = childDraft.replace(/\s+/g, " ").trim();
                    if (!name || !childRole) {
                      setError("Choose daughter or son, and name the child.");
                      return;
                    }
                    if (sameName(name, person.name) || parents.some((parent) => sameName(parent, name)) || sameName(name, wife)) {
                      setError("A child cannot be the same person, a parent, or a spouse.");
                      return;
                    }
                    setChildren((current) => (current.some((item) => sameName(item.name, name)) ? current : [...current, { name, role: childRole }]));
                    setChildDraft("");
                    setChildRole("");
                    setError(null);
                  }}
                >
                  Add child
                </button>
              </div>
            </div>
          </section>
          <section className="editor-section editor-wide">
            <header className="editor-head">
              <h3>Same person</h3>
              <p>Two names for one person. Combining keeps this name.</p>
            </header>
            <div className="draft-add">
              <NameSearch mode="field" id="draft-combine" label="Search for the same person" value={combineWith} options={options} exclude={[person.name]} onChange={setCombineWith} />
              <button type="button" onClick={() => void combine()} disabled={pending || !combineWith.trim()}>
                Combine
              </button>
            </div>
          </section>
        </div>
        <div className="correction-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save to the family"}
          </button>
        </div>
        {error ? <p className="notice">{error}</p> : null}
        {saved ? <p className="count">{saved}</p> : null}
      </form>
    </div>,
    document.body,
  );
}

function LinkField({
  label,
  hint,
  names,
  rows,
  options,
  draft,
  placeholder,
  exclude,
  onOpen,
  onDraft,
  onRemove,
  onAdd,
}: {
  label: string;
  hint: string;
  names: string[];
  rows: DraftRow[];
  options: KnownName[];
  draft: string;
  placeholder: string;
  exclude: string[];
  onOpen: (key: string) => void;
  onDraft: (value: string) => void;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
}) {
  return (
    <section className="editor-section">
      <header className="editor-head">
        <h3>{label}</h3>
        <p>{hint}</p>
      </header>
      {names.length > 0 ? (
        <ul className="parent-chips">
          {names.map((name) => (
            <li key={name}>
              <RowName name={name} rows={rows} onOpen={onOpen} />
              <button type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(name)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="draft-note">None yet.</p>
      )}
      <NameSearch mode="add" label={placeholder} value={draft} options={options} exclude={exclude} onChange={onDraft} onSelect={onAdd} />
    </section>
  );
}

