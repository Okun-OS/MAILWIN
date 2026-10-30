import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { audit } from "../audit";
import { getOwnedAccount, markReauthRequired, providerFor, type Account } from "./accounts";
import { refreshThreads, storeMessage } from "./sync";
import { replySubject } from "./mime";
import { ReauthRequiredError, type Address, type OutgoingAttachment } from "./types";

type Actor = "user" | "marvin" | "automation";

const address = z.object({ email: z.string().email(), name: z.string().optional() });

export const sendEmailPayload = z.object({
  accountId: z.string().uuid(),
  to: z.array(address).min(1),
  cc: z.array(address).default([]),
  subject: z.string().min(1),
  body: z.string().min(1),
  /** Interne E-Mail-ID, auf die geantwortet wird */
  replyToEmailId: z.string().uuid().optional(),
  /** Interne E-Mail-ID, die weitergeleitet wird (Anhänge werden mitgeschickt) */
  forwardEmailId: z.string().uuid().optional(),
});
export type SendEmailPayload = z.infer<typeof sendEmailPayload>;

async function ownedEmail(userId: string, emailId: string) {
  const [row] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, userId)));
  if (!row) throw new Error("E-Mail nicht gefunden.");
  return row;
}

async function ownedThread(userId: string, threadId: string) {
  const [row] = await db
    .select()
    .from(schema.emailThreads)
    .where(and(eq(schema.emailThreads.id, threadId), eq(schema.emailThreads.userId, userId)));
  if (!row) throw new Error("Konversation nicht gefunden.");
  return row;
}

/** Signatur des Kontos (oder globale Standardsignatur) – Spezifikation 10. */
export async function signatureFor(userId: string, accountId: string) {
  const rows = await db
    .select()
    .from(schema.signatures)
    .where(and(eq(schema.signatures.userId, userId), or(eq(schema.signatures.accountId, accountId), isNull(schema.signatures.accountId))))
    .orderBy(desc(schema.signatures.isDefault));
  return rows.find((s) => s.accountId === accountId && s.isDefault) ?? rows.find((s) => s.accountId === accountId) ?? rows.find((s) => s.isDefault) ?? null;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Versendet eine E-Mail. Aufrufer sind ausschließlich: Nutzer-Klick oder eine bestätigte Freigabe. */
export async function sendEmail(userId: string, raw: SendEmailPayload, actor: Actor) {
  const payload = sendEmailPayload.parse(raw);
  const account = await getOwnedAccount(userId, payload.accountId);
  const provider = providerFor(account);

  let threading: { inReplyTo?: string; references?: string[]; providerThreadId?: string } = {};
  let subject = payload.subject;
  let quoted = "";
  let attachments: OutgoingAttachment[] = [];

  if (payload.replyToEmailId) {
    const original = await ownedEmail(userId, payload.replyToEmailId);
    if (original.accountId !== account.id) throw new Error("Antworten müssen über das Konto der ursprünglichen Nachricht gesendet werden.");
    const thread = await ownedThread(userId, original.threadId);
    // RFC 5322: References = Kette der beantworteten Nachricht + deren Message-ID. Sonst ordnen
    // IMAP-Server und die Mailprogramme der Empfänger die Antwort keiner Konversation zu.
    threading = {
      inReplyTo: original.messageIdHeader ?? undefined,
      references: [...new Set([...original.references, ...(original.messageIdHeader ? [original.messageIdHeader] : [])])],
      providerThreadId: thread.providerThreadId,
    };
    subject = replySubject(subject || original.subject || "");
  }
  if (payload.forwardEmailId) {
    const original = await ownedEmail(userId, payload.forwardEmailId);
    const from = original.from ? `${original.from.name ?? ""} <${original.from.email}>`.trim() : "";
    quoted = `\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${from}\nDatum: ${original.receivedAt.toLocaleString("de-DE")}\nBetreff: ${original.subject ?? ""}\n\n${original.bodyText ?? ""}`;
    const origAccount = original.accountId === account.id ? account : await getOwnedAccount(userId, original.accountId);
    const origProvider = providerFor(origAccount);
    const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.emailId, original.id));
    attachments = await Promise.all(
      atts.map(async (a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        content: await origProvider.getAttachment(original.providerMessageId, a.providerAttachmentId),
      })),
    );
  }

  const signature = await signatureFor(userId, account.id);
  const text = `${payload.body}${signature ? `\n\n-- \n${signature.text}` : ""}${quoted}`;
  const html =
    `<div>${escapeHtml(payload.body).replace(/\n/g, "<br>")}</div>` +
    (signature ? `<br><div class="mw-signature">${signature.html}</div>` : "") +
    (quoted ? `<br><div>${escapeHtml(quoted).replace(/\n/g, "<br>")}</div>` : "");

  const from: Address = { email: account.emailAddress, ...(account.displayName ? { name: account.displayName } : {}) };
  try {
    const sent = await provider.send({ from, to: payload.to, cc: payload.cc, subject, text, html, attachments, ...threading });
    // Gesendete Nachricht sofort lokal ablegen, damit Verlauf und „wartet auf Antwort“ stimmen
    const threadId = await storeMessage(account, await provider.getMessage(sent.providerMessageId));
    await refreshThreads(account, [threadId]);
    await audit({
      userId,
      accountId: account.id,
      actor,
      action: payload.forwardEmailId ? "forward_email" : "send_email",
      targetType: "email",
      targetId: sent.providerMessageId,
      status: "success",
      details: { to: payload.to.map((a) => a.email), cc: payload.cc.map((a) => a.email), subject },
    });
    return { ...sent, threadId };
  } catch (err) {
    await handleProviderError(account, err);
    await audit({
      userId,
      accountId: account.id,
      actor,
      action: "send_email",
      status: "failed",
      details: { to: payload.to.map((a) => a.email), subject, error: String((err as Error).message) },
    });
    throw err;
  }
}

async function handleProviderError(account: Account, err: unknown) {
  if (err instanceof ReauthRequiredError) await markReauthRequired(account, err.message);
}

type ThreadOp = "archive" | "trash" | "read" | "unread" | "labels";

/** Organisationsaktionen auf einer Konversation – immer zuerst beim Anbieter, dann lokal. */
export async function threadAction(
  userId: string,
  threadId: string,
  op: ThreadOp,
  actor: Actor,
  labels?: { add?: string[]; remove?: string[] },
) {
  const thread = await ownedThread(userId, threadId);
  const account = await getOwnedAccount(userId, thread.accountId);
  const provider = providerFor(account);
  const msgs = await db.select().from(schema.emails).where(eq(schema.emails.threadId, threadId));
  const ref = { providerThreadId: thread.providerThreadId, providerMessageIds: msgs.map((m) => m.providerMessageId) };
  try {
    if (op === "archive") await provider.archiveThread(ref);
    else if (op === "trash") await provider.trashThread(ref);
    else if (op === "read" || op === "unread") await provider.markThreadRead(ref, op === "read");
    else await provider.modifyThreadLabels(ref, labels?.add ?? [], labels?.remove ?? []);
  } catch (err) {
    await handleProviderError(account, err);
    await audit({ userId, accountId: account.id, actor, action: `thread_${op}`, targetType: "thread", targetId: threadId, status: "failed", details: { error: String((err as Error).message) } });
    throw err;
  }

  // Lokalen Stand angleichen (der nächste Delta-Sync bestätigt ihn)
  for (const m of msgs) {
    let labelIds = [...m.labelIds];
    if (op === "archive") labelIds = labelIds.filter((l) => l !== "INBOX");
    if (op === "trash") labelIds = [...labelIds.filter((l) => l !== "INBOX"), "TRASH"];
    if (op === "read") labelIds = labelIds.filter((l) => l !== "UNREAD");
    if (op === "unread" && !labelIds.includes("UNREAD")) labelIds.push("UNREAD");
    if (op === "labels") labelIds = [...new Set([...labelIds.filter((l) => !labels?.remove?.includes(l)), ...(labels?.add ?? [])])];
    await db
      .update(schema.emails)
      .set({ labelIds, isRead: !labelIds.includes("UNREAD") })
      .where(eq(schema.emails.id, m.id));
  }
  await refreshThreads(account, [threadId]);
  await audit({ userId, accountId: account.id, actor, action: `thread_${op}`, targetType: "thread", targetId: threadId, status: "success", details: labels ?? {} });
}

/** Legt ein Label an (oder liefert das vorhandene). */
export async function ensureLabel(userId: string, accountId: string, name: string, actor: Actor) {
  const account = await getOwnedAccount(userId, accountId);
  const [existing] = await db
    .select()
    .from(schema.labels)
    .where(and(eq(schema.labels.accountId, account.id), eq(schema.labels.name, name)));
  if (existing) return existing;
  const created = await providerFor(account).createLabel(name);
  const [row] = await db
    .insert(schema.labels)
    .values({ accountId: account.id, providerLabelId: created.providerLabelId, name: created.name, kind: created.kind })
    .returning();
  await audit({ userId, accountId: account.id, actor, action: "create_label", targetType: "label", targetId: created.providerLabelId, status: "success", details: { name } });
  return row!;
}
