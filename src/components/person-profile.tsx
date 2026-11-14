"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { formatLifeDate, type Person, type PersonAvatar } from "@/lib/photo-types";

type ProfileTab = "about" | "photos" | "history" | "general" | "documents";

type ProfilePhoto = {
  sourcePath: string;
  rotation: number;
};

type LibraryPage = {
  summary: string;
  sources: Array<{ filename: string }>;
  documents?: Array<{ sourcePath: string; filename: string; label: string }>;
  mentions?: string[];
  error?: string;
};

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "about", label: "About" },
  { id: "photos", label: "Photos" },
  { id: "history", label: "History" },
  { id: "general", label: "General" },
  { id: "documents", label: "Documents" },
];

const LIBRARY_TABS = new Set<ProfileTab>(["history", "general", "documents"]);

export function PersonProfile({
  person,
  photos,
  facts,
  onOpen,
}: {
  person: Person;
  photos: ProfilePhoto[];
  facts: ReactNode;
  onOpen: (sourcePath: string) => void;
}) {
  const [tab, setTab] = useState<ProfileTab>("about");
  const [pages, setPages] = useState<Partial<Record<ProfileTab, LibraryPage>>>({});
  const [pending, setPending] = useState<ProfileTab | null>(null);
  const [seenPerson, setSeenPerson] = useState(person.id);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  if (seenPerson !== person.id) {
    setSeenPerson(person.id);
    setTab("about");
    setPages({});
    setPending(null);
  }
  const portrait = photos.find((photo) => photo.sourcePath === person.avatar?.sourcePath) ?? photos[0];

  useEffect(() => {
    if (!LIBRARY_TABS.has(tab) || pagesRef.current[tab]) return;
    let cancel = false;
    setPending(tab);
    fetch(`/api/person?id=${encodeURIComponent(person.id)}&part=${tab}`)
      .then((response) => response.json() as Promise<LibraryPage>)
      .then((payload) => {
        if (!cancel) setPages((current) => ({ ...current, [tab]: payload }));
      })
      .catch(() => {
        if (!cancel) setPages((current) => ({ ...current, [tab]: { summary: "", sources: [], error: "The library could not be read just now." } }));
      })
      .finally(() => {
        if (!cancel) setPending((current) => (current === tab ? null : current));
      });
    return () => {
      cancel = true;
    };
  }, [tab, person.id]);

  return (
    <div className="profile-focus">
      <div className="profile-tabs" role="tablist" aria-label={`${person.name}'s record`}>
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "about" ? (
        <div className="about-row" role="tabpanel">
          {portrait ? (
            <button type="button" className="about-portrait" aria-label={person.avatar ? `Photo of ${person.name}` : portrait.sourcePath} onClick={() => onOpen(person.avatar?.sourcePath ?? portrait.sourcePath)}>
              <img src={person.avatar ? avatarSrc(person.avatar, portrait.rotation) : mediaSrc(portrait.sourcePath, "thumb", portrait.rotation)} alt="" />
            </button>
          ) : (
            <span className="about-portrait" aria-hidden="true">
              {initials(person.name)}
            </span>
          )}
          <div className="about-facts">
            <dl className="profile-facts">
              <div>
                <dt>Born</dt>
                <dd>{person.born ? formatLifeDate(person.born) : <Blank />}</dd>
              </div>
              <div>
                <dt>Died</dt>
                <dd>{person.died ? formatLifeDate(person.died) : <Blank />}</dd>
              </div>
              <div>
                <dt>Birthplace</dt>
                <dd>{person.birthplace || <Blank />}</dd>
              </div>
              <div>
                <dt>Lived</dt>
                <dd>{person.home || <Blank />}</dd>
              </div>
              <div>
                <dt>School</dt>
                <dd>{person.school || <Blank />}</dd>
              </div>
              <div>
                <dt>Work</dt>
                <dd>{person.work || <Blank />}</dd>
              </div>
            </dl>
            {facts}
          </div>
        </div>
      ) : null}
      {tab === "photos" ? (
        <div role="tabpanel">
          {photos.length > 0 ? (
            <ul className="profile-gallery">
              {photos.map((photo) => (
                <li key={photo.sourcePath}>
                  <button type="button" aria-label={photo.sourcePath} onClick={() => onOpen(photo.sourcePath)}>
                    <img src={mediaSrc(photo.sourcePath, "thumb", photo.rotation)} alt="" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="count">No photo is tagged with {person.name} yet.</p>
          )}
        </div>
      ) : null}
      {tab === "history" ? <LibraryPanel page={pages.history} pending={pending === "history"} onOpen={onOpen} empty="The pages do not give school or work for them yet." /> : null}
      {tab === "general" ? <LibraryPanel page={pages.general} pending={pending === "general"} onOpen={onOpen} empty="The pages do not give a longer account yet." /> : null}
      {tab === "documents" ? (
        <div role="tabpanel">
          <DocumentList person={person} page={pages.documents} pending={pending === "documents"} onOpen={onOpen} />
        </div>
      ) : null}
    </div>
  );
}

function Blank() {
  return <span className="about-blank">—</span>;
}

function LibraryPanel({ page, pending, onOpen, empty }: { page?: LibraryPage; pending: boolean; onOpen: (file: string) => void; empty: string }) {
  const text = page ? libraryText(page.summary) : "";
  const allowed = new Set((page?.mentions ?? []).map((file) => file.toUpperCase()));
  return (
    <div className="profile-copy" role="tabpanel">
      {!page || pending ? <p className="count">Reading the indexed pages…</p> : null}
      {page?.error ? <p className="notice">{page.error}</p> : null}
      {text ? <FileText text={text} onOpen={onOpen} allowed={allowed} /> : null}
      {page && !pending && !page.error && !text ? <p className="count">{empty}</p> : null}
    </div>
  );
}

function DocumentList({ person, page, pending, onOpen }: { person: Person; page?: LibraryPage; pending: boolean; onOpen: (file: string) => void }) {
  const documents = page?.documents ?? [];
  const mentioned = page?.mentions ?? [];
  const cited = mentioned.filter((file) => !documents.some((item) => item.filename.toLowerCase() === file.toLowerCase() || item.sourcePath.toLowerCase() === file.toLowerCase()));
  const text = page ? libraryText(page.summary) : "";
  const allowed = new Set([...documents.map((item) => item.filename.toUpperCase()), ...mentioned.map((file) => file.toUpperCase())]);
  const quiet = Boolean(page) && !pending && documents.length === 0 && cited.length === 0 && !text;
  return (
    <>
      {(!page || pending) && documents.length === 0 ? <p className="count">Looking for pages that mention {person.name}…</p> : null}
      {page?.error ? <p className="notice">{page.error}</p> : null}
      {documents.length > 0 || cited.length > 0 ? (
        <ul className="doc-list">
          {documents.map((item) => (
            <li key={item.sourcePath}>
              <button type="button" onClick={() => onOpen(item.sourcePath)}>
                <img src={mediaSrc(item.sourcePath, "thumb")} alt="" />
                <span>
                  <strong>{item.label}</strong>
                  {item.filename}
                </span>
              </button>
            </li>
          ))}
          {cited.map((file) => (
            <li key={file}>
              <button type="button" onClick={() => onOpen(file)}>
                <img src={mediaSrc(file, "thumb")} alt="" />
                <span>
                  <strong>Mentioned</strong>
                  {file}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {text ? <FileText text={text} onOpen={onOpen} allowed={allowed} /> : null}
      {quiet && !page?.error ? <p className="count">No document in the library mentions {person.name} yet.</p> : null}
    </>
  );
}

function FileText({ text, onOpen, allowed }: { text: string; onOpen: (file: string) => void; allowed?: Set<string> }) {
  const parts = text.split(FILE_PATTERN);
  return (
    <div className="person-summary">
      {parts.map((part, index) =>
        FILE_PATTERN.test(part) && (!allowed || allowed.has(part.toUpperCase())) ? (
          <button key={`${part}-${index}`} type="button" className="doc-link" onClick={() => onOpen(part)}>
            {part}
          </button>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </div>
  );
}

const FILE_PATTERN = /(IMG_\d+\.(?:HEIC|PNG|JPE?G))/i;

function libraryText(summary: string | undefined): string {
  return (summary ?? "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .filter((line) => !/^\s*(pages:|sources:|the relevant pages are:?)\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mediaSrc(sourcePath: string, size: "thumb" | "full", rotation = 0): string {
  const turn = rotation === 90 || rotation === 180 || rotation === 270 ? `&turn=${rotation}` : "";
  return `/api/media?size=${size}&path=${encodeURIComponent(sourcePath)}${turn}`;
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
