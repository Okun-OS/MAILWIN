import { requireUser } from "@/lib/auth/session";
import { integrations } from "@/lib/env";
import { listConversations } from "@/lib/marvin/conversations";
import { MarvinComposer } from "@/components/MarvinComposer";
import { MarvinPointing } from "@/components/Marvin";
import { ConversationList } from "./layout-parts";

export const metadata = { title: "Marvin" };
export const maxDuration = 300;

const EXAMPLES = [
  "Was ist heute Wichtiges angekommen?",
  "Welche E-Mails muss ich dringend beantworten?",
  "Hat sich jemand auf meine Anfragen der letzten Woche gemeldet?",
  "Marvin, bring Ordnung in mein Postfach.",
];

export default async function MarvinPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const user = await requireUser();
  const { prompt } = await searchParams;
  const conversations = await listConversations(user.id);
  return (
    <div className="chat-layout">
      <ConversationList conversations={conversations} />
      <section className="card chat">
        <div className="chat-scroll" style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <MarvinPointing width={220} priority />
          <h1 style={{ fontSize: 26 }}>Wobei kann ich helfen?</h1>
          <p className="muted" style={{ maxWidth: 520, margin: 0 }}>
            Ich lese, sortiere und beantworte deine E-Mails – Versand nur nach deiner Freigabe. Ich kann auch im Web recherchieren und Aufgaben anlegen.
          </p>
          {!integrations.marvin && <div className="notice warn">Marvin ist auf diesem Server noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt).</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 640 }}>
            {EXAMPLES.map((e) => (
              <a key={e} href={`/marvin?prompt=${encodeURIComponent(e)}`} className="badge" style={{ padding: "8px 12px", fontSize: 12.5 }}>
                {e}
              </a>
            ))}
          </div>
        </div>
        <MarvinComposer key={prompt ?? ""} initialText={prompt ?? ""} />
      </section>
    </div>
  );
}
