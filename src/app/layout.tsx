import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Outfit } from "next/font/google";

import { AccountMenu } from "@/components/account-menu";
import { SiteNav } from "@/components/site-nav";
import { currentAccount } from "@/lib/accounts";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const account = await currentAccount();
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable}`}>
        <div className="app-frame">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                The Husfelds
              </Link>
              <div className="topbar-tools">
                <SiteNav />
                <AccountMenu account={account} />
              </div>
            </div>
          </header>
          <div className="app-body">{children}</div>
        </div>
      </body>
    </html>
  );
}
