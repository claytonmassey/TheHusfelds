"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/gallery", label: "Gallery" },
  { href: "/draft", label: "The Family" },
  { href: "/family", label: "Tree" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Sections">
      {LINKS.map((link) => {
        const current = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
