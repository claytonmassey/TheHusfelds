import { KnowledgeRepo } from "@/components/knowledge-repo";
import { loadKnowledge } from "@/lib/library-view";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const items = await loadKnowledge();
  return (
    <main className="page-screen">
      <header className="page-heading">
        <p className="eyebrow">Uploads</p>
        <h1>Knowledge</h1>
        <p className="lede">Documents added here are transcribed and become part of what the chat can answer.</p>
      </header>
      <KnowledgeRepo items={items} />
    </main>
  );
}
