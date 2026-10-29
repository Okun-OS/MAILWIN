import { google, type gmail_v1 } from "googleapis";
import { buildMimeMessage, decodeBytes, decodeHeaderWords, htmlToText, parseAddressList } from "./mime";
import {
  ReauthRequiredError,
  type ChangeSet,
  type MailProvider,
  type NormalizedAttachment,
  type NormalizedMessage,
  type OutgoingMessage,
  type ProviderLabel,
} from "./types";

type Part = gmail_v1.Schema$MessagePart;
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

function header(part: Part | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ? decodeHeaderWords(h.value) : null;
}

function charsetOf(part: Part): string | null {
  const ct = header(part, "Content-Type") ?? "";
  return ct.match(/charset="?([^";\s]+)"?/i)?.[1] ?? null;
}

/** Wandelt eine Gmail-API-Nachricht (format=full) in das gemeinsame Format um. */
export function parseGmailMessage(msg: gmail_v1.Schema$Message): NormalizedMessage {
  const payload = msg.payload ?? {};
  let text: string | null = null;
  let html: string | null = null;
  const attachments: NormalizedAttachment[] = [];

  const walk = (part: Part) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        providerAttachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mime || "application/octet-stream",
        sizeBytes: part.body.size ?? 0,
      });
      return;
    }
    if (part.parts?.length) {
      part.parts.forEach(walk);
      return;
    }
    const data = part.body?.data;
    if (!data) return;
    const decoded = decodeBytes(Buffer.from(data, "base64url"), charsetOf(part));
    if (mime === "text/plain" && text === null) text = decoded;
    else if (mime === "text/html" && html === null) html = decoded;
  };
  walk(payload);

  const labelIds = msg.labelIds ?? [];
  const references = (header(payload, "References") ?? "").split(/\s+/).filter(Boolean);
  const date = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(header(payload, "Date") ?? Date.now());

  return {
    providerMessageId: msg.id!,
    providerThreadId: msg.threadId!,
    messageIdHeader: header(payload, "Message-ID") ?? header(payload, "Message-Id"),
    references,
    from: parseAddressList(header(payload, "From"))[0] ?? null,
    to: parseAddressList(header(payload, "To")),
    cc: parseAddressList(header(payload, "Cc")),
    replyTo: parseAddressList(header(payload, "Reply-To")),
    subject: header(payload, "Subject") ?? "",
    snippet: decodeEntities(msg.snippet ?? ""),
    bodyText: text ?? (html ? htmlToText(html) : null),
    bodyHtml: html,
    labelIds,
    isRead: !labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    isOutgoing: labelIds.includes("SENT"),
    receivedAt: date,
    attachments,
  };
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function isAuthError(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
  return e?.response?.data?.error === "invalid_grant" || e?.response?.status === 401 || /invalid_grant/.test(e?.message ?? "");
}

/** Gmail-Adapter. Der OAuth-Client kümmert sich selbst um das Erneuern abgelaufener Zugangstoken. */
export class GmailProvider implements MailProvider {
  readonly provider = "gmail" as const;
  private gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: "v1", auth });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isAuthError(err)) throw new ReauthRequiredError();
      throw err;
    }
  }

  async listMessageIds(opts: { query?: string; pageToken?: string; max?: number }) {
    const res = await this.call(() =>
      this.gmail.users.messages.list({ userId: "me", q: opts.query, pageToken: opts.pageToken, maxResults: opts.max ?? 50 }),
    );
    return { ids: (res.data.messages ?? []).map((m) => m.id!).filter(Boolean), nextPageToken: res.data.nextPageToken ?? undefined };
  }

  async getMessage(id: string) {
    const res = await this.call(() => this.gmail.users.messages.get({ userId: "me", id, format: "full" }));
    return parseGmailMessage(res.data);
  }

  async currentCursor() {
    const res = await this.call(() => this.gmail.users.getProfile({ userId: "me" }));
    return String(res.data.historyId);
  }

  async changesSince(cursor: string): Promise<ChangeSet> {
    const changed = new Set<string>();
    const deleted = new Set<string>();
    let pageToken: string | undefined;
    let latest = cursor;
    try {
      do {
        const res = await this.call(() =>
          this.gmail.users.history.list({ userId: "me", startHistoryId: cursor, pageToken, maxResults: 500 }),
        );
        for (const h of res.data.history ?? []) {
          h.messagesAdded?.forEach((m) => m.message?.id && changed.add(m.message.id));
          h.labelsAdded?.forEach((m) => m.message?.id && changed.add(m.message.id));
          h.labelsRemoved?.forEach((m) => m.message?.id && changed.add(m.message.id));
          h.messagesDeleted?.forEach((m) => m.message?.id && deleted.add(m.message.id));
        }
        if (res.data.historyId) latest = String(res.data.historyId);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      // 404: historyId zu alt → vollständige Synchronisation
      if ((err as { response?: { status?: number } })?.response?.status === 404) return { kind: "reset" };
      throw err;
    }
    deleted.forEach((id) => changed.delete(id));
    return { kind: "delta", changedMessageIds: [...changed], deletedMessageIds: [...deleted], cursor: latest };
  }

  async send(message: OutgoingMessage) {
    const raw = Buffer.from(buildMimeMessage(message), "utf8").toString("base64url");
    const res = await this.call(() =>
      this.gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: message.providerThreadId } }),
    );
    return { providerMessageId: res.data.id!, providerThreadId: res.data.threadId! };
  }

  async modifyThreadLabels(threadId: string, add: string[], remove: string[]) {
    await this.call(() =>
      this.gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: add, removeLabelIds: remove } }),
    );
  }

  archiveThread(threadId: string) {
    return this.modifyThreadLabels(threadId, [], ["INBOX"]);
  }

  async trashThread(threadId: string) {
    await this.call(() => this.gmail.users.threads.trash({ userId: "me", id: threadId }));
  }

  markThreadRead(threadId: string, read: boolean) {
    return read ? this.modifyThreadLabels(threadId, [], ["UNREAD"]) : this.modifyThreadLabels(threadId, ["UNREAD"], []);
  }

  async listLabels(): Promise<ProviderLabel[]> {
    const res = await this.call(() => this.gmail.users.labels.list({ userId: "me" }));
    return (res.data.labels ?? []).map((l) => ({
      providerLabelId: l.id!,
      name: l.name!,
      kind: l.type === "system" ? "system" : "user",
      color: l.color?.backgroundColor ?? null,
    }));
  }

  async createLabel(name: string): Promise<ProviderLabel> {
    const res = await this.call(() =>
      this.gmail.users.labels.create({
        userId: "me",
        requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      }),
    );
    return { providerLabelId: res.data.id!, name: res.data.name!, kind: "user" };
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const res = await this.call(() =>
      this.gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId }),
    );
    return Buffer.from(res.data.data ?? "", "base64url");
  }
}
