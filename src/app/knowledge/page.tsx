import { KnowledgeRepo } from "@/components/knowledge-repo";
import { loadKnowledge } from "@/lib/library-view";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const items = await loadKnowledge();
  return (
    <main className="page-screen">
      <header className="page-heading">
        <p className="eyebrow">Library</p>
        <h1>Knowledge</h1>
        <p className="lede">Every document in the library. A scanned page shows what it is.</p>
      </header>
      <KnowledgeRepo items={items} />
    </main>
  );
}
