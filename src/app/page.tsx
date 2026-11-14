import { AskChat } from "@/components/ask-chat";
import { readCorrections } from "@/lib/corrections";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <main className="chat-screen">
      <header className="page-heading">
        <p className="eyebrow">Ask</p>
        <h1>Chat</h1>
        <p className="lede">Answers come from the papers in the library.</p>
      </header>
      <AskChat initialCorrections={await readCorrections()} />
    </main>
  );
}
