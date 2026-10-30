import type { Address } from "../db/schema";

export type { Address };

export interface NormalizedAttachment {
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Anbieterunabhängige Darstellung einer Nachricht (Spezifikation 15.1). */
export interface NormalizedMessage {
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string | null;
  references: string[];
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  subject: string;
  snippet: string;
  bodyText: string | null;
  bodyHtml: string | null;
  labelIds: string[];
  isRead: boolean;
  isStarred: boolean;
  isOutgoing: boolean;
  receivedAt: Date;
  attachments: NormalizedAttachment[];
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  /** Anbieter-Thread, damit Antworten im selben Verlauf landen */
  providerThreadId?: string;
  attachments?: OutgoingAttachment[];
}

export interface ProviderLabel {
  providerLabelId: string;
  name: string;
  kind: "system" | "user" | "folder";
  color?: string | null;
}

/** Lesestatus/Markierung bekannter Nachrichten (IMAP liefert keine Änderungshistorie wie Gmail) */
export type FlagUpdate = { isRead: boolean; isStarred: boolean };

export type ChangeSet =
  | { kind: "delta"; changedMessageIds: string[]; deletedMessageIds: string[]; cursor: string; flagUpdates?: Record<string, FlagUpdate> }
  /** Cursor zu alt → vollständige Neusynchronisation nötig */
  | { kind: "reset" };

/** Eine Konversation beim Anbieter: Gmail kennt Threads, IMAP nur einzelne Nachrichten. */
export interface ThreadRef {
  providerThreadId: string;
  providerMessageIds: string[];
}

/**
 * Gemeinsame Schnittstelle aller E-Mail-Anbieter. Gmail arbeitet mit Labels,
 * IMAP/Exchange mit Ordnern – `kind` an den Labels macht den Unterschied sichtbar,
 * die Operationen bleiben gleich.
 */
export interface MailProvider {
  readonly provider: "gmail" | "microsoft" | "imap";
  listMessageIds(opts: { query?: string; pageToken?: string; max?: number }): Promise<{ ids: string[]; nextPageToken?: string }>;
  getMessage(providerMessageId: string): Promise<NormalizedMessage>;
  currentCursor(): Promise<string>;
  /** `knownMessageIds`: lokal bekannte Nachrichten – nötig, um bei IMAP Löschungen zu erkennen */
  changesSince(cursor: string, knownMessageIds?: string[]): Promise<ChangeSet>;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string; providerThreadId: string }>;
  /** Gmail: Labels setzen/entfernen. IMAP: in den Ordner `add[0]` verschieben. */
  modifyThreadLabels(thread: ThreadRef, add: string[], remove: string[]): Promise<void>;
  archiveThread(thread: ThreadRef): Promise<void>;
  /** Papierkorb – wiederherstellbar. Dauerhaftes Löschen bietet die Schnittstelle bewusst nicht an. */
  trashThread(thread: ThreadRef): Promise<void>;
  markThreadRead(thread: ThreadRef, read: boolean): Promise<void>;
  listLabels(): Promise<ProviderLabel[]>;
  createLabel(name: string): Promise<ProviderLabel>;
  getAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Buffer>;
}

/** Zugangstoken abgelaufen/widerrufen – Konto muss neu verbunden werden (Abnahmetest 9). */
export class ReauthRequiredError extends Error {
  constructor(message = "Die Verbindung zum E-Mail-Konto ist abgelaufen. Bitte neu verbinden.") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}
