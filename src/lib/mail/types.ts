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

export type ChangeSet =
  | { kind: "delta"; changedMessageIds: string[]; deletedMessageIds: string[]; cursor: string }
  /** Cursor zu alt → vollständige Neusynchronisation nötig */
  | { kind: "reset" };

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
  changesSince(cursor: string): Promise<ChangeSet>;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string; providerThreadId: string }>;
  modifyThreadLabels(providerThreadId: string, add: string[], remove: string[]): Promise<void>;
  archiveThread(providerThreadId: string): Promise<void>;
  /** Papierkorb – wiederherstellbar. Dauerhaftes Löschen bietet die Schnittstelle bewusst nicht an. */
  trashThread(providerThreadId: string): Promise<void>;
  markThreadRead(providerThreadId: string, read: boolean): Promise<void>;
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
