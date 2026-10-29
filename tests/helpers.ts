import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import type { ChangeSet, MailProvider, NormalizedMessage, OutgoingMessage, ProviderLabel } from "@/lib/mail/types";

export async function resetDb() {
  await db.execute(sql`truncate table users, jobs restart identity cascade`);
}

export async function createUserWithAccount(opts: { level?: "read" | "organize" | "communicate" } = {}) {
  const [user] = await db.insert(schema.users).values({ email: `u${Math.random().toString(36).slice(2)}@test.de`, name: "Sarah Neumann" }).returning();
  const [account] = await db
    .insert(schema.connectedAccounts)
    .values({
      userId: user!.id,
      provider: "gmail",
      emailAddress: user!.email,
      displayName: "Sarah Neumann",
      refreshTokenEnc: encrypt("refresh"),
      permissionLevel: opts.level ?? "communicate",
    })
    .returning();
  return { user: user!, account: account! };
}

export function message(partial: Partial<NormalizedMessage> & { providerMessageId: string }): NormalizedMessage {
  return {
    providerThreadId: `t-${partial.providerMessageId}`,
    messageIdHeader: `<${partial.providerMessageId}@mail.test>`,
    references: [],
    from: { name: "Lena Schröder", email: "lena@nordlicht.de" },
    to: [{ email: "sarah@test.de" }],
    cc: [],
    replyTo: [],
    subject: "Freigabe Projektplanung",
    snippet: "Hallo Sarah …",
    bodyText: "Hallo Sarah, wir können starten.",
    bodyHtml: null,
    labelIds: ["INBOX", "UNREAD"],
    isRead: false,
    isStarred: false,
    isOutgoing: false,
    receivedAt: new Date(),
    attachments: [],
    ...partial,
  };
}

/** Anbieter ohne Netzwerk: hält Nachrichten im Speicher und zeichnet Aufrufe auf. */
export class FakeProvider implements MailProvider {
  readonly provider = "gmail" as const;
  messages = new Map<string, NormalizedMessage>();
  sent: OutgoingMessage[] = [];
  calls: string[] = [];
  cursor = "100";
  failWith: Error | null = null;

  constructor(initial: NormalizedMessage[] = []) {
    initial.forEach((m) => this.messages.set(m.providerMessageId, m));
  }
  private guard(name: string) {
    this.calls.push(name);
    if (this.failWith) throw this.failWith;
  }
  async listMessageIds() {
    this.guard("listMessageIds");
    return { ids: [...this.messages.keys()] };
  }
  async getMessage(id: string) {
    this.guard("getMessage");
    const m = this.messages.get(id);
    if (!m) throw new Error("not found");
    return m;
  }
  async currentCursor() {
    this.guard("currentCursor");
    return this.cursor;
  }
  async changesSince(): Promise<ChangeSet> {
    this.guard("changesSince");
    return { kind: "delta", changedMessageIds: [], deletedMessageIds: [], cursor: this.cursor };
  }
  async send(msg: OutgoingMessage) {
    this.guard("send");
    this.sent.push(msg);
    const id = `sent-${this.sent.length}`;
    const threadId = msg.providerThreadId ?? `t-${id}`;
    this.messages.set(id, message({ providerMessageId: id, providerThreadId: threadId, from: msg.from, to: msg.to, subject: msg.subject, bodyText: msg.text, isOutgoing: true, isRead: true, labelIds: ["SENT"] }));
    return { providerMessageId: id, providerThreadId: threadId };
  }
  async modifyThreadLabels() { this.guard("modifyThreadLabels"); }
  async archiveThread() { this.guard("archiveThread"); }
  async trashThread() { this.guard("trashThread"); }
  async markThreadRead() { this.guard("markThreadRead"); }
  async listLabels(): Promise<ProviderLabel[]> {
    this.guard("listLabels");
    return [{ providerLabelId: "INBOX", name: "INBOX", kind: "system" }];
  }
  async createLabel(name: string): Promise<ProviderLabel> {
    this.guard("createLabel");
    return { providerLabelId: `Label_${name}`, name, kind: "user" };
  }
  async getAttachment() {
    this.guard("getAttachment");
    return Buffer.from("PDF");
  }
}
