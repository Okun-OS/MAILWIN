import Link from "next/link";
import { Icon } from "@/components/Icon";

export function ConversationList({ conversations, activeId }: { conversations: { id: string; title: string | null }[]; activeId?: string }) {
  return (
    <aside className="card chat-sidebar" aria-label="Unterhaltungen">
      <Link href="/marvin" className="btn btn-primary btn-sm" style={{ marginBottom: 8 }}>
        <Icon name="plus" size={14} /> Neue Unterhaltung
      </Link>
      {conversations.map((c) => (
        <Link key={c.id} href={`/marvin/${c.id}`} className={c.id === activeId ? "active" : undefined}>
          {c.title ?? "Unterhaltung"}
        </Link>
      ))}
    </aside>
  );
}
