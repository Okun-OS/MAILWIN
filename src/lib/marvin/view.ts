import { inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { SYSTEM_NOTE_PREFIX, type StoredMessage } from "./history";
import { TOOL_LABELS } from "./tools";

export type ApprovalView = typeof schema.approvalRequests.$inferSelect;

export type ChatItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "tools"; key: string; labels: string[] }
  | { kind: "sources"; key: string; sources: { title: string; url: string }[] }
  | { kind: "approval"; key: string; approval: ApprovalView }
  | { kind: "note"; key: string; text: string };

type Block = { type: string; [k: string]: unknown };

/** Übersetzt den gespeicherten API-Verlauf in Chat-Elemente für die Oberfläche. */
export async function toChatItems(rows: StoredMessage[]): Promise<ChatItem[]> {
  const toolUseIds = rows.flatMap((r) => (r.content as Block[]).filter((b) => b.type === "tool_use").map((b) => String(b.id)));
  const approvals = toolUseIds.length
    ? await db.select().from(schema.approvalRequests).where(inArray(schema.approvalRequests.toolUseId, toolUseIds))
    : [];

  const items: ChatItem[] = [];
  for (const row of rows) {
    const blocks = row.content as Block[];
    if (row.role === "user") {
      for (const [i, b] of blocks.entries()) {
        if (b.type !== "text") continue;
        const text = String(b.text);
        if (text.startsWith("<kontext>")) continue;
        if (text.startsWith(SYSTEM_NOTE_PREFIX)) items.push({ kind: "note", key: `${row.id}-${i}`, text: text.slice(SYSTEM_NOTE_PREFIX.length).trim() });
        else items.push({ kind: "user", key: `${row.id}-${i}`, text });
      }
      continue;
    }
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => String(b.text))
      .join("")
      .trim();
    const labels = blocks
      .filter((b) => b.type === "tool_use" || b.type === "server_tool_use")
      .map((b) => {
        const label = TOOL_LABELS[String(b.name)] ?? String(b.name);
        const query = (b.input as { query?: string } | undefined)?.query;
        return b.type === "server_tool_use" && query ? `${label}: „${query}“` : label;
      });
    const sources = blocks
      .filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content))
      .flatMap((b) => (b.content as { type: string; title?: string; url?: string }[]).filter((r) => r.type === "web_search_result"))
      .map((r) => ({ title: r.title ?? r.url ?? "", url: r.url ?? "" }))
      .filter((s, i, all) => s.url && all.findIndex((x) => x.url === s.url) === i)
      .slice(0, 6);
    if (labels.length) items.push({ kind: "tools", key: `${row.id}-t`, labels });
    if (sources.length) items.push({ kind: "sources", key: `${row.id}-s`, sources });
    if (text) items.push({ kind: "assistant", key: `${row.id}-a`, text });
    for (const b of blocks.filter((x) => x.type === "tool_use")) {
      const approval = approvals.find((a) => a.toolUseId === b.id);
      if (approval) items.push({ kind: "approval", key: approval.id, approval });
    }
  }
  return items;
}
