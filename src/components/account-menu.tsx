"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AccountView } from "@/lib/accounts";

export function AccountMenu({ account }: { account: AccountView | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState(account);
  const [open, setOpen] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(account), [account]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: signingUp ? "signup" : "login", firstName, lastName, email, password }),
      });
      const payload = (await response.json()) as { account?: AccountView; error?: string };
      if (!response.ok || !payload.account) {
        setError(payload.error ?? "That email or password is not right.");
        return;
      }
      setCurrent(payload.account);
      setOpen(false);
      setPassword("");
      router.refresh();
    } catch {
      setError("The login could not be reached just now.");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      setCurrent(null);
      setPassword("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (current) {
    return (
      <div className="account-menu" ref={menuRef}>
        <button type="button" className="account-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
          <span className="account-avatar" aria-hidden="true">
            {initials(current.name)}
          </span>
          <span className="account-trigger-name">{current.name}</span>
        </button>
        {open ? (
          <div className="account-popover" role="menu">
            <p className="account-identity">
              <strong>{current.name}</strong>
              <span>{current.email}</span>
            </p>
            <button type="button" role="menuitem" onClick={() => void logout()} disabled={pending}>
              {pending ? "Logging out" : "Log out"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="account-menu" ref={menuRef}>
      <button type="button" className="account-login" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Log in
      </button>
      {open ? (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2>{signingUp ? "Create account" : "Log in"}</h2>
          {signingUp ? (
            <div className="account-names">
              <div>
                <label htmlFor="account-first">First name</label>
                <input id="account-first" value={firstName} autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} />
              </div>
              <div>
                <label htmlFor="account-last">Last name</label>
                <input id="account-last" value={lastName} autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} />
              </div>
            </div>
          ) : null}
          <label htmlFor="account-email">Email</label>
          <input id="account-email" type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="account-password">Password</label>
          <input
            id="account-password"
            type="password"
            value={password}
            autoComplete={signingUp ? "new-password" : "current-password"}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="notice">{error}</p> : null}
          <button type="submit" disabled={pending}>
            {pending ? "Saving" : signingUp ? "Sign up" : "Log in"}
          </button>
          <button
            type="button"
            className="account-switch"
            onClick={() => {
              setSigningUp((value) => !value);
              setError(null);
            }}
          >
            {signingUp ? "Already have an account? Log in" : "Create an account"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase();
}
