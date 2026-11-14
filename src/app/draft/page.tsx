import { DraftMonitor } from "@/components/draft-monitor";

export const dynamic = "force-dynamic";

export default function DraftPage() {
  return (
    <main className="page-screen draft-screen">
      <header className="page-heading">
        <h1>The Family</h1>
      </header>
      <DraftMonitor />
    </main>
  );
}
