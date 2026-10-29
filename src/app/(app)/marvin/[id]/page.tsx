import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getOwnedConversation } from "@/lib/marvin/agent";
import { loadMessages } from "@/lib/marvin/history";
import { toChatItems } from "@/lib/marvin/view";
import { listConversations } from "@/lib/marvin/conversations";
import { listAccounts } from "@/lib/mail/accounts";
import { MarvinComposer } from "@/components/MarvinComposer";
import { MarvinThread } from "@/components/MarvinThread";
import { ConversationList } from "../layout-parts";

export const maxDuration = 300;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const conversation = await getOwnedConversation(user.id, id).catch(() => null);
  if (!conversation) notFound();
  const [items, conversations, accounts] = await Promise.all([toChatItems(await loadMessages(id)), listConversations(user.id), listAccounts(user.id)]);
  return (
    <div className="chat-layout">
      <ConversationList conversations={conversations} activeId={id} />
      <section className="card chat">
        <div className="chat-scroll bottom">
          <div className="chat-items">
            <MarvinThread items={items} accountEmails={Object.fromEntries(accounts.map((a) => [a.id, a.emailAddress]))} />
          </div>
        </div>
        <MarvinComposer conversationId={id} placeholder="Antworte Marvin …" />
      </section>
    </div>
  );
}
