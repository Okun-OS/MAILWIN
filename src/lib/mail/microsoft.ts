import { buildMimeMessage, htmlToText } from "./mime";
import {
  ReauthRequiredError,
  type Address,
  type ChangeSet,
  type MailProvider,
  type NormalizedMessage,
  type OutgoingMessage,
  type ProviderLabel,
  type ThreadRef,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SYNC_DAYS = 30;
const MAX_INITIAL = 300;
const FOLDERS = ["inbox", "sentitems"] as const;

const SELECT = [
  "id",
  "conversationId",
  "internetMessageId",
  "subject",
  "bodyPreview",
  "body",
  "from",
  "toRecipients",
  "ccRecipients",
  "replyTo",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "flag",
  "parentFolderId",
  "categories",
  "internetMessageHeaders",
].join(",");

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };
export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  receivedDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  parentFolderId?: string;
  categories?: string[];
  internetMessageHeaders?: { name: string; value: string }[];
  "@removed"?: { reason: string };
}

const addr = (r: GraphRecipient | undefined): Address | null =>
  r?.emailAddress?.address ? { email: r.emailAddress.address.toLowerCase(), ...(r.emailAddress.name ? { name: r.emailAddress.name } : {}) } : null;
const addrs = (list: GraphRecipient[] | undefined) => (list ?? []).map(addr).filter((a): a is Address => a !== null);

/** Graph-Nachricht → gemeinsames Format. Kategorien werden zu Labels. */
export function normalizeGraphMessage(m: GraphMessage, folders: { inbox: string; sent: string }, attachments: NormalizedMessage["attachments"] = []): NormalizedMessage {
  const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? null) : null;
  const text = html ? htmlToText(html) : (m.body?.content ?? m.bodyPreview ?? null);
  const header = (name: string) => m.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name)?.value;
  const labelIds = [m.parentFolderId === folders.inbox ? "INBOX" : m.parentFolderId === folders.sent ? "SENT" : (m.parentFolderId ?? "OTHER"), ...(m.categories ?? [])];
  if (!m.isRead) labelIds.push("UNREAD");
  if (m.flag?.flagStatus === "flagged") labelIds.push("STARRED");
  return {
    providerMessageId: m.id,
    providerThreadId: m.conversationId ?? m.id,
    messageIdHeader: m.internetMessageId ?? null,
    references: (header("references") ?? "").split(/\s+/).filter(Boolean),
    from: addr(m.from),
    to: addrs(m.toRecipients),
    cc: addrs(m.ccRecipients),
    replyTo: addrs(m.replyTo),
    subject: m.subject ?? "",
    snippet: m.bodyPreview ?? "",
    bodyText: text,
    bodyHtml: html,
    labelIds,
    isRead: Boolean(m.isRead),
    isStarred: m.flag?.flagStatus === "flagged",
    isOutgoing: m.parentFolderId === folders.sent,
    receivedAt: new Date(m.receivedDateTime ?? Date.now()),
    attachments,
  };
}

/**
 * Microsoft 365 / Outlook.com über Microsoft Graph.
 * Unveränderliche IDs (ImmutableId), damit Nachrichten beim Verschieben ihre ID behalten.
 * Konversationen kommen von Exchange (conversationId), Outlook-Kategorien dienen als Labels.
 */
export class MicrosoftProvider implements MailProvider {
  readonly provider = "microsoft" as const;
  private folderIds: { inbox: string; sent: string } | null = null;
  private initialIds: string[] | null = null;

  constructor(private readonly getToken: () => Promise<string>) {}

  private async request(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
        ...(init.body && !init.raw ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401) throw new ReauthRequiredError();
    if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  private async folders() {
    if (!this.folderIds) {
      const [inbox, sent] = await Promise.all([this.json<{ id: string }>("/me/mailFolders/inbox?$select=id"), this.json<{ id: string }>("/me/mailFolders/sentitems?$select=id")]);
      this.folderIds = { inbox: inbox.id, sent: sent.id };
    }
    return this.folderIds;
  }

  /** Läuft eine Delta-Runde vollständig durch und liefert Änderungen + neuen deltaLink. */
  private async deltaRound(startUrl: string) {
    const items: GraphMessage[] = [];
    let url: string | undefined = startUrl;
    let deltaLink = "";
    while (url) {
      const page: { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await this.json(url, { headers: { Prefer: 'IdType="ImmutableId", odata.maxpagesize=100' } });
      items.push(...page.value);
      url = page["@odata.nextLink"];
      if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
    }
    return { items, deltaLink };
  }

  /** Erster Delta-Durchlauf (letzte 30 Tage) – liefert die IDs für den Erstabgleich gleich mit. */
  async currentCursor(): Promise<string> {
    const since = new Date(Date.now() - SYNC_DAYS * 86_400_000).toISOString();
    const cursor: Record<string, string> = {};
    const ids: { id: string; at: string }[] = [];
    for (const folder of FOLDERS) {
      const { items, deltaLink } = await this.deltaRound(`/me/mailFolders/${folder}/messages/delta?$select=id,receivedDateTime&$filter=receivedDateTime+ge+${since}`);
      ids.push(...items.filter((i) => !i["@removed"]).map((i) => ({ id: i.id, at: i.receivedDateTime ?? "" })));
      cursor[folder] = deltaLink;
    }
    this.initialIds = ids.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_INITIAL).map((x) => x.id);
    return JSON.stringify(cursor);
  }

  async listMessageIds(): Promise<{ ids: string[] }> {
    if (!this.initialIds) await this.currentCursor();
    return { ids: this.initialIds ?? [] };
  }

  async changesSince(cursorJson: string): Promise<ChangeSet> {
    let cursor: Record<string, string>;
    try {
      cursor = JSON.parse(cursorJson);
    } catch {
      return { kind: "reset" };
    }
    const changed = new Set<string>();
    const deleted = new Set<string>();
    const next: Record<string, string> = {};
    for (const folder of FOLDERS) {
      if (!cursor[folder]) return { kind: "reset" };
      let round;
      try {
        round = await this.deltaRound(cursor[folder]!);
      } catch (err) {
        // abgelaufener Delta-Token → vollständiger Neuabgleich
        if (/Graph 410|syncStateNotFound|resyncRequired/i.test((err as Error).message)) return { kind: "reset" };
        throw err;
      }
      for (const item of round.items) {
        // Neue und geänderte Nachrichten (auch Lesestatus) werden neu geladen – das gleicht alles ab
        if (item["@removed"]) deleted.add(item.id);
        else changed.add(item.id);
      }
      next[folder] = round.deltaLink;
    }
    return { kind: "delta", changedMessageIds: [...changed], deletedMessageIds: [...deleted], cursor: JSON.stringify(next) };
  }

  async getMessage(id: string): Promise<NormalizedMessage> {
    const [m, folders] = await Promise.all([this.json<GraphMessage>(`/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`), this.folders()]);
    const atts = await this.json<{ value: { id: string; name: string; contentType: string; size: number; isInline: boolean }[] }>(
      `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`,
    );
    return normalizeGraphMessage(
      m,
      folders,
      atts.value.filter((a) => !a.isInline).map((a) => ({ providerAttachmentId: a.id, filename: a.name, mimeType: a.contentType, sizeBytes: a.size })),
    );
  }

  async send(message: OutgoingMessage) {
    const raw = buildMimeMessage(message);
    // MIME-Versand: Graph übernimmt Header (In-Reply-To/References) und legt die Nachricht in „Gesendete Elemente“ ab
    await this.request("/me/sendMail", { method: "POST", body: Buffer.from(raw, "utf8").toString("base64"), headers: { "Content-Type": "text/plain" }, raw: true });
    const messageId = raw.match(/^Message-ID: (.+)$/m)?.[1]?.trim();
    for (let attempt = 0; attempt < 6 && messageId; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 + attempt * 500));
      const found = await this.json<{ value: { id: string; conversationId: string }[] }>(
        `/me/mailFolders/sentitems/messages?$select=id,conversationId&$filter=internetMessageId eq '${messageId.replace(/'/g, "''")}'`,
      );
      if (found.value[0]) return { providerMessageId: found.value[0].id, providerThreadId: found.value[0].conversationId };
    }
    throw new Error("Gesendet – die Nachricht ist aber (noch) nicht in „Gesendete Elemente“ zu finden.");
  }

  private async eachMessage(thread: ThreadRef, fn: (id: string) => Promise<unknown>) {
    for (const id of thread.providerMessageIds) await fn(encodeURIComponent(id));
  }

  archiveThread(thread: ThreadRef) {
    return this.eachMessage(thread, (id) => this.request(`/me/messages/${id}/move`, { method: "POST", body: JSON.stringify({ destinationId: "archive" }) }));
  }

  trashThread(thread: ThreadRef) {
    return this.eachMessage(thread, (id) => this.request(`/me/messages/${id}/move`, { method: "POST", body: JSON.stringify({ destinationId: "deleteditems" }) }));
  }

  markThreadRead(thread: ThreadRef, read: boolean) {
    return this.eachMessage(thread, (id) => this.request(`/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ isRead: read }) }));
  }

  /** Kategorien setzen/entfernen; UNREAD/INBOX werden auf Lesestatus bzw. Archiv abgebildet. */
  async modifyThreadLabels(thread: ThreadRef, add: string[], remove: string[]) {
    if (add.includes("UNREAD")) return this.markThreadRead(thread, false);
    if (remove.includes("UNREAD")) return this.markThreadRead(thread, true);
    if (remove.includes("INBOX") && !add.length) return this.archiveThread(thread);
    const system = new Set(["INBOX", "SENT", "STARRED", "UNREAD"]);
    await this.eachMessage(thread, async (id) => {
      const m = await this.json<{ categories: string[] }>(`/me/messages/${id}?$select=categories`);
      const categories = [...new Set([...m.categories.filter((c) => !remove.includes(c)), ...add.filter((c) => !system.has(c))])];
      await this.request(`/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ categories }) });
    });
  }

  async listLabels(): Promise<ProviderLabel[]> {
    return [
      { providerLabelId: "INBOX", name: "Posteingang", kind: "system" },
      { providerLabelId: "SENT", name: "Gesendet", kind: "system" },
    ];
  }

  /** Outlook-Kategorien entstehen beim ersten Setzen an einer Nachricht – kein eigener API-Aufruf nötig. */
  async createLabel(name: string): Promise<ProviderLabel> {
    return { providerLabelId: name, name, kind: "user" };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const res = await this.request(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Termine (Kalenderansicht) für Dashboard und Wochenübersicht. */
  async calendarView(from: Date, to: Date) {
    const items: { id: string; subject?: string; start: { dateTime: string }; end: { dateTime: string }; isAllDay: boolean; location?: { displayName?: string }; onlineMeeting?: unknown; isCancelled?: boolean }[] = [];
    let url: string | undefined = `/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=id,subject,start,end,isAllDay,location,onlineMeeting,isCancelled&$top=100`;
    while (url) {
      const page: { value: typeof items; "@odata.nextLink"?: string } = await this.json(url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      items.push(...page.value);
      url = page["@odata.nextLink"];
    }
    return items.filter((e) => !e.isCancelled);
  }
}
