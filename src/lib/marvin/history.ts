import { asc, eq, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "../db";

export type StoredMessage = typeof schema.marvinMessages.$inferSelect;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** Hängt eine Nachricht an (append-only – frühere Einträge werden nie verändert). */
export async function appendMessage(conversationId: string, role: "user" | "assistant", content: unknown[]): Promise<StoredMessage> {
  const [row] = await db
    .insert(schema.marvinMessages)
    .values({
      conversationId,
      role,
      content,
      seq: sql`(select coalesce(max(seq), 0) + 1 from ${schema.marvinMessages} where conversation_id = ${conversationId})`,
    })
    .returning();
  await db.update(schema.marvinConversations).set({ updatedAt: new Date() }).where(eq(schema.marvinConversations.id, conversationId));
  return row!;
}

export const SYSTEM_NOTE_PREFIX = "[Systemhinweis von Mailwin]";

/** Ereignisse außerhalb des Chats (z. B. Freigabe erteilt) – damit Marvin beim nächsten Schritt Bescheid weiß. */
export async function appendSystemNote(conversationId: string, note: string) {
  await appendMessage(conversationId, "user", [{ type: "text", text: `${SYSTEM_NOTE_PREFIX} ${note}` }]);
}

export async function loadMessages(conversationId: string): Promise<StoredMessage[]> {
  return db.select().from(schema.marvinMessages).where(eq(schema.marvinMessages.conversationId, conversationId)).orderBy(asc(schema.marvinMessages.seq));
}

/**
 * Baut die API-Historie. Aufeinanderfolgende Nachrichten derselben Rolle
 * (z. B. Tool-Ergebnisse + Systemhinweis) werden zu einer zusammengeführt;
 * Tool-Ergebnisse bleiben dabei vorn, wie die API es verlangt.
 */
export function toApiMessages(rows: Pick<StoredMessage, "role" | "content">[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const row of rows) {
    const content = row.content as Anthropic.Beta.Messages.BetaContentBlockParam[];
    const prev = out[out.length - 1];
    if (prev && prev.role === row.role) {
      prev.content = [...(prev.content as Anthropic.Beta.Messages.BetaContentBlockParam[]), ...content];
    } else {
      out.push({ role: row.role, content: [...content] });
    }
  }
  return out;
}
