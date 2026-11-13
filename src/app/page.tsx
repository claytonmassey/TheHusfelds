import { AskChat } from "@/components/ask-chat";
import { readCorrections } from "@/lib/corrections";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <main className="chat-screen">
      <AskChat initialCorrections={await readCorrections()} />
    </main>
  );
}
