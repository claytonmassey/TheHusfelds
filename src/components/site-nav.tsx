"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/gallery", label: "Gallery" },
  { href: "/draft", label: "The Family" },
  { href: "/family", label: "Tree" },
];

export function SiteNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav ref={navRef} className={open ? "site-nav is-open" : "site-nav"} aria-label="Sections">
      <button
        type="button"
        className="nav-menu"
        aria-expanded={open}
        aria-controls="section-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nav-menu-bars" />
      </button>
      <div id="section-menu" className="nav-links">
        {LINKS.map((link) => {
          const current = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
