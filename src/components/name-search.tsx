"use client";

import { useState, type Ref } from "react";

import type { KnownName } from "@/lib/known-name";
import { sameName } from "@/lib/photo-types";

export function NameSearch({
  mode,
  id,
  inputRef,
  label,
  value,
  options,
  exclude = [],
  browse = false,
  onChange,
  onSelect,
}: {
  mode: "add" | "field";
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  value: string;
  options: KnownName[];
  exclude?: string[];
  browse?: boolean;
  onChange: (value: string) => void;
  onSelect?: (name: string) => void;
}) {
  const [open, setOpen] = useState(browse);
  const needle = value.trim().toLowerCase();
  const pool = options.filter((item) => !exclude.some((name) => sameName(name, item.name)));
  const ordered = browse && !needle
    ? [...pool.filter((item) => item.where === "family"), ...pool.filter((item) => item.where !== "family")]
    : pool;
  const matches = needle
    ? ordered.filter((item) => item.name.toLowerCase().includes(needle)).slice(0, 8)
    : browse
      ? ordered.slice(0, 24)
      : [];

  function resolved(raw: string): string {
    const clean = raw.replace(/\s+/g, " ").trim();
    const exact = matches.find((item) => sameName(item.name, clean));
    if (exact) return exact.name;
    if (matches.length === 1) return matches[0].name;
    return clean;
  }

  function pick(name: string) {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (mode === "add") onSelect?.(clean);
    else onChange(clean);
    setOpen(false);
  }

  return (
    <div className="name-search">
      <div className="name-search-row">
        <input
          id={id}
          ref={inputRef}
          value={value}
          placeholder={label}
          aria-label={label}
          aria-expanded={open && matches.length > 0}
          aria-autocomplete="list"
          maxLength={80}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key !== "Enter") return;
            const exact = matches.find((item) => sameName(item.name, value));
            const only = matches.length === 1 ? matches[0] : undefined;
            const picked = exact ?? only;
            if (mode === "add") {
              event.preventDefault();
              if (value.trim()) onSelect?.(picked?.name ?? value);
              return;
            }
            if (!open || !needle) return;
            event.preventDefault();
            if (picked) onChange(picked.name);
            setOpen(false);
          }}
        />
        {mode === "add" ? (
          <button
            type="button"
            onClick={() => {
              if (value.trim()) onSelect?.(resolved(value));
            }}
            disabled={value.trim().length === 0}
          >
            Add
          </button>
        ) : null}
      </div>
      {open && (needle || (browse && matches.length > 0)) ? (
        <ul role="listbox">
          {matches.map((item) => (
            <li key={`${item.where}-${item.name}`}>
              <button
                type="button"
                role="option"
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(item.name);
                }}
              >
                <span>{item.name}</span>
                {item.where === "draft" ? <em>Draft</em> : null}
              </button>
            </li>
          ))}
          {needle && matches.length === 0 ? <li className="name-search-empty">No one matches. This name can still be used.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
