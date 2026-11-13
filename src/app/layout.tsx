import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Outfit } from "next/font/google";

import { SiteNav } from "@/components/site-nav";

import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "The Husfelds",
  description: "Ask questions about the Husfeld family papers.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable}`}>
        <div className="app-frame">
          <header className="topbar">
            <Link href="/" className="brand">
              The Husfelds
            </Link>
            <SiteNav />
          </header>
          <div className="app-body">{children}</div>
        </div>
      </body>
    </html>
  );
}
