import { DraftMonitor } from "@/components/draft-monitor";

export const dynamic = "force-dynamic";

export default function DraftPage() {
  return (
    <main className="page-screen draft-screen">
      <header className="page-heading">
        <p className="eyebrow">People</p>
        <h1>The Family</h1>
        <p className="lede">Everyone named in the papers, grouped into households.</p>
      </header>
      <DraftMonitor />
    </main>
  );
}
