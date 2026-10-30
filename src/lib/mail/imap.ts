import { createHash } from "node:crypto";
import { ImapFlow, type ListResponse } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { buildMimeMessage, htmlToText } from "./mime";
import type { ImapSettings } from "./imap-presets";
import {
  ReauthRequiredError,
  type Address,
  type ChangeSet,
  type FlagUpdate,
  type MailProvider,
  type NormalizedMessage,
  type OutgoingMessage,
  type ProviderLabel,
  type ThreadRef,
} from "./types";

const SYNC_DAYS = 30;
const MAX_INITIAL = 300;

/** Nachrichten-ID: Ordner | UIDVALIDITY | UID – eindeutig und stabil, solange der Ordner nicht neu angelegt wird. */
export function encodeId(path: string, uidValidity: bigint | number | string, uid: number) {
  return `${encodeURIComponent(path)}|${uidValidity}|${uid}`;
}
export function decodeId(id: string) {
  const [p, v, u] = id.split("|");
  if (!p || !v || !u) throw new Error(`Ungültige Nachrichten-ID: ${id}`);
  return { path: decodeURIComponent(p), uidValidity: v, uid: Number(u) };
}

/**
 * IMAP kennt keine Konversationen. Die Thread-ID wird aus den RFC-Headern abgeleitet:
 * erste Message-ID der References-Kette, sonst In-Reply-To, sonst die eigene Message-ID.
 */
export function deriveThreadId(m: { references?: string | string[]; inReplyTo?: string; messageId?: string; subject?: string }) {
  const refs = Array.isArray(m.references) ? m.references : m.references ? m.references.split(/\s+/) : [];
  const root = refs.find(Boolean) ?? m.inReplyTo ?? m.messageId ?? `subject:${(m.subject ?? "").replace(/^((re|aw|fwd?|wg)\s*:\s*)+/i, "").trim().toLowerCase()}`;
  return createHash("sha256").update(root.trim()).digest("hex").slice(0, 24);
}

function addresses(a: AddressObject | AddressObject[] | undefined): Address[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list
    .flatMap((x) => x.value)
    .filter((v) => v.address)
    .map((v) => ({ email: v.address!.toLowerCase(), ...(v.name ? { name: v.name } : {}) }));
}

type Role = "inbox" | "sent" | "other";

/** Wandelt eine geparste IMAP-Nachricht in das gemeinsame Format. */
export function normalizeParsed(id: string, parsed: ParsedMail, flags: Set<string>, role: Role, folder: string): NormalizedMessage {
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text ?? (html ? htmlToText(html) : null);
  const labelIds = [role === "inbox" ? "INBOX" : role === "sent" ? "SENT" : folder];
  if (!flags.has("\\Seen")) labelIds.push("UNREAD");
  if (flags.has("\\Flagged")) labelIds.push("STARRED");
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  return {
    providerMessageId: id,
    providerThreadId: deriveThreadId(parsed),
    messageIdHeader: parsed.messageId ?? null,
    references,
    from: addresses(parsed.from)[0] ?? null,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    replyTo: addresses(parsed.replyTo),
    subject: parsed.subject ?? "",
    snippet: (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    bodyText: text,
    bodyHtml: html,
    labelIds,
    isRead: flags.has("\\Seen"),
    isStarred: flags.has("\\Flagged"),
    isOutgoing: role === "sent",
    receivedAt: parsed.date ?? new Date(),
    attachments: parsed.attachments
      .filter((a) => a.contentDisposition !== "inline" || a.filename)
      .map((a, i) => ({ providerAttachmentId: String(i), filename: a.filename ?? `anhang-${i + 1}`, mimeType: a.contentType, sizeBytes: a.size })),
  };
}

function isAuthError(err: unknown) {
  const e = err as { authenticationFailed?: boolean; responseCode?: number; code?: string };
  return Boolean(e?.authenticationFailed) || e?.code === "EAUTH" || e?.responseCode === 535;
}

/**
 * IMAP/SMTP-Anbieter (GMX, WEB.DE, T-Online, iCloud, eigene Domains …).
 * Ordner werden als Labels abgebildet; Posteingang und Gesendet werden synchronisiert.
 */
export class ImapProvider implements MailProvider {
  readonly provider = "imap" as const;
  private folders: { inbox: string; sent: string | null; trash: string | null; archive: string | null; all: ListResponse[] } | null = null;

  constructor(
    private readonly settings: ImapSettings,
    private readonly password: string,
    private readonly fromEmail: string,
  ) {}

  private async session<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.settings.imapHost,
      port: this.settings.imapPort,
      secure: this.settings.imapSecure,
      auth: { user: this.settings.username, pass: this.password },
      logger: false,
      disableAutoIdle: true,
    });
    try {
      await client.connect();
    } catch (err) {
      if (isAuthError(err)) throw new ReauthRequiredError("Anmeldung beim Mailserver fehlgeschlagen. Bitte Passwort bzw. App-Passwort prüfen.");
      throw err;
    }
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async resolveFolders(client: ImapFlow) {
    if (this.folders) return this.folders;
    const all = await client.list();
    const by = (use: string) => all.find((f) => f.specialUse === use)?.path ?? null;
    this.folders = { inbox: "INBOX", sent: by("\\Sent"), trash: by("\\Trash"), archive: by("\\Archive"), all };
    return this.folders;
  }

  private roleOf(path: string, f: { sent: string | null }): Role {
    if (path.toUpperCase() === "INBOX") return "inbox";
    if (path === f.sent) return "sent";
    return "other";
  }

  /** Prüft Zugangsdaten für IMAP und SMTP – vor dem Speichern eines Kontos. */
  async verify(): Promise<void> {
    await this.session(async (c) => {
      await this.resolveFolders(c);
    });
    try {
      await this.transport().verify();
    } catch (err) {
      if (isAuthError(err)) throw new ReauthRequiredError("Anmeldung beim Postausgangsserver (SMTP) fehlgeschlagen.");
      throw new Error(`Postausgangsserver nicht erreichbar: ${(err as Error).message}`);
    }
  }

  private transport() {
    return nodemailer.createTransport({
      host: this.settings.smtpHost,
      port: this.settings.smtpPort,
      secure: this.settings.smtpSecure,
      auth: { user: this.settings.username, pass: this.password },
    });
  }

  private syncFolders(f: { inbox: string; sent: string | null }) {
    return [f.inbox, ...(f.sent ? [f.sent] : [])];
  }

  async listMessageIds(): Promise<{ ids: string[] }> {
    return this.session(async (c) => {
      const f = await this.resolveFolders(c);
      const since = new Date(Date.now() - SYNC_DAYS * 86_400_000);
      const ids: { id: string; uid: number }[] = [];
      for (const path of this.syncFolders(f)) {
        const lock = await c.getMailboxLock(path);
        try {
          const box = c.mailbox as { uidValidity: bigint };
          const uids = (await c.search({ since }, { uid: true })) || [];
          ids.push(...uids.map((uid) => ({ id: encodeId(path, box.uidValidity, uid), uid })));
        } finally {
          lock.release();
        }
      }
      // neueste zuerst, Obergrenze wie bei Gmail
      return { ids: ids.sort((a, b) => b.uid - a.uid).slice(0, MAX_INITIAL).map((x) => x.id) };
    });
  }

  async getMessage(id: string): Promise<NormalizedMessage> {
    const { path, uidValidity, uid } = decodeId(id);
    return this.session(async (c) => {
      const f = await this.resolveFolders(c);
      const lock = await c.getMailboxLock(path);
      try {
        const box = c.mailbox as { uidValidity: bigint };
        if (String(box.uidValidity) !== uidValidity) throw new Error("Ordner wurde zurückgesetzt (UIDVALIDITY).");
        const msg = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
        if (!msg || !msg.source) throw new Error("Nachricht nicht gefunden.");
        const parsed = await simpleParser(msg.source);
        return normalizeParsed(id, parsed, msg.flags ?? new Set(), this.roleOf(path, f), path);
      } finally {
        lock.release();
      }
    });
  }

  async currentCursor(): Promise<string> {
    return this.session(async (c) => {
      const f = await this.resolveFolders(c);
      const cursor: Record<string, { v: string; next: number }> = {};
      for (const path of this.syncFolders(f)) {
        const st = await c.status(path, { uidNext: true, uidValidity: true });
        if (st) cursor[path] = { v: String(st.uidValidity), next: st.uidNext ?? 1 };
      }
      return JSON.stringify(cursor);
    });
  }

  async changesSince(cursorJson: string, knownMessageIds: string[] = []): Promise<ChangeSet> {
    let cursor: Record<string, { v: string; next: number }>;
    try {
      cursor = JSON.parse(cursorJson);
    } catch {
      return { kind: "reset" };
    }
    return this.session(async (c) => {
      const f = await this.resolveFolders(c);
      const changed: string[] = [];
      const deleted: string[] = [];
      const flagUpdates: Record<string, FlagUpdate> = {};
      const next: typeof cursor = {};
      for (const path of this.syncFolders(f)) {
        const lock = await c.getMailboxLock(path);
        try {
          const box = c.mailbox as { uidValidity: bigint; uidNext: number };
          const prev = cursor[path];
          if (prev && prev.v !== String(box.uidValidity)) return { kind: "reset" } as const;
          const from = prev?.next ?? 1;
          if (box.uidNext > from) {
            const fresh = (await c.search({ uid: `${from}:*` }, { uid: true })) || [];
            changed.push(...fresh.filter((u) => u >= from).map((u) => encodeId(path, box.uidValidity, u)));
          }
          // Lesestatus und Löschungen der lokal bekannten Nachrichten dieses Ordners abgleichen
          const known = knownMessageIds.map(decodeId).filter((k) => k.path === path && k.uidValidity === String(box.uidValidity));
          if (known.length) {
            const present = new Map<number, Set<string>>();
            for await (const m of c.fetch(known.map((k) => k.uid).join(","), { flags: true }, { uid: true })) present.set(m.uid, m.flags ?? new Set());
            for (const k of known) {
              const id = encodeId(path, box.uidValidity, k.uid);
              const flags = present.get(k.uid);
              if (!flags) deleted.push(id);
              else flagUpdates[id] = { isRead: flags.has("\\Seen"), isStarred: flags.has("\\Flagged") };
            }
          }
          next[path] = { v: String(box.uidValidity), next: box.uidNext };
        } finally {
          lock.release();
        }
      }
      return { kind: "delta", changedMessageIds: changed, deletedMessageIds: deleted, cursor: JSON.stringify(next), flagUpdates };
    });
  }

  async send(message: OutgoingMessage) {
    const raw = buildMimeMessage(message);
    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map((a) => a.email);
    try {
      await this.transport().sendMail({ envelope: { from: message.from.email, to: recipients }, raw });
    } catch (err) {
      if (isAuthError(err)) throw new ReauthRequiredError("Anmeldung beim Postausgangsserver (SMTP) fehlgeschlagen.");
      throw err;
    }
    const parsed = await simpleParser(raw);
    const threadId = deriveThreadId(parsed);
    // Ohne Kopie in „Gesendet“ gäbe es keinen Verlauf – die meisten Anbieter legen sie per SMTP nicht selbst ab
    const stored = await this.session(async (c) => {
      const f = await this.resolveFolders(c);
      if (!f.sent) return null;
      if (this.settings.appendSent) {
        const res = await c.append(f.sent, raw, ["\\Seen"], new Date());
        if (res && res.uid && res.uidValidity) return encodeId(f.sent, res.uidValidity, res.uid);
      }
      // Server ohne UIDPLUS oder automatische Ablage: per Message-ID suchen
      const lock = await c.getMailboxLock(f.sent);
      try {
        const box = c.mailbox as { uidValidity: bigint };
        for (let attempt = 0; attempt < 3; attempt++) {
          const found = parsed.messageId ? (await c.search({ header: { "message-id": parsed.messageId } }, { uid: true })) || [] : [];
          if (found.length) return encodeId(f.sent, box.uidValidity, found[found.length - 1]!);
          await new Promise((r) => setTimeout(r, 700));
        }
        return null;
      } finally {
        lock.release();
      }
    });
    if (!stored) throw new Error("Gesendet – die Kopie im Ordner „Gesendet“ wurde aber nicht gefunden.");
    return { providerMessageId: stored, providerThreadId: threadId };
  }

  /** Nachrichten einer Konversation, gruppiert nach Ordner. */
  private groups(thread: ThreadRef) {
    const map = new Map<string, number[]>();
    for (const id of thread.providerMessageIds) {
      const { path, uid } = decodeId(id);
      map.set(path, [...(map.get(path) ?? []), uid]);
    }
    return map;
  }

  private async moveTo(thread: ThreadRef, target: (f: NonNullable<ImapProvider["folders"]>, c: ImapFlow) => Promise<string>) {
    await this.session(async (c) => {
      const f = await this.resolveFolders(c);
      const dest = await target(f, c);
      for (const [path, uids] of this.groups(thread)) {
        if (path === dest || path === f.sent) continue; // Gesendetes bleibt, wo es ist
        const lock = await c.getMailboxLock(path);
        try {
          await c.messageMove(uids.join(","), dest, { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  }

  private async ensureFolder(c: ImapFlow, name: string) {
    const f = await this.resolveFolders(c);
    if (!f.all.some((x) => x.path === name)) {
      await c.mailboxCreate(name);
      this.folders = null;
    }
    return name;
  }

  archiveThread(thread: ThreadRef) {
    return this.moveTo(thread, async (f, c) => f.archive ?? (await this.ensureFolder(c, "Archiv")));
  }

  trashThread(thread: ThreadRef) {
    return this.moveTo(thread, async (f, c) => f.trash ?? (await this.ensureFolder(c, "Papierkorb")));
  }

  async markThreadRead(thread: ThreadRef, read: boolean) {
    await this.session(async (c) => {
      for (const [path, uids] of this.groups(thread)) {
        const lock = await c.getMailboxLock(path);
        try {
          if (read) await c.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
          else await c.messageFlagsRemove(uids.join(","), ["\\Seen"], { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  }

  async modifyThreadLabels(thread: ThreadRef, add: string[], remove: string[]) {
    if (add.includes("UNREAD")) return this.markThreadRead(thread, false);
    if (remove.includes("UNREAD")) return this.markThreadRead(thread, true);
    const folder = add.find((l) => !["INBOX", "SENT", "STARRED"].includes(l));
    if (folder) return this.moveTo(thread, async (_f, c) => this.ensureFolder(c, folder));
    if (remove.includes("INBOX")) return this.archiveThread(thread);
  }

  async listLabels(): Promise<ProviderLabel[]> {
    return this.session(async (c) => {
      const f = await this.resolveFolders(c);
      return f.all.map((x) => ({ providerLabelId: x.path, name: x.name, kind: x.specialUse || x.path === "INBOX" ? ("system" as const) : ("folder" as const) }));
    });
  }

  async createLabel(name: string): Promise<ProviderLabel> {
    return this.session(async (c) => {
      await this.ensureFolder(c, name);
      return { providerLabelId: name, name, kind: "folder" };
    });
  }

  async getAttachment(id: string, attachmentId: string): Promise<Buffer> {
    const { path, uid } = decodeId(id);
    return this.session(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) throw new Error("Nachricht nicht gefunden.");
        const parsed = await simpleParser(msg.source);
        const att = parsed.attachments.filter((a) => a.contentDisposition !== "inline" || a.filename)[Number(attachmentId)];
        if (!att) throw new Error("Anhang nicht gefunden.");
        return att.content;
      } finally {
        lock.release();
      }
    });
  }
}
