import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { audit } from "../audit";
import { markReauthRequired, providerFor, type Account } from "./accounts";
import { ReauthRequiredError, type MailProvider, type NormalizedMessage } from "./types";

const INITIAL_QUERY = "newer_than:30d -in:spam -in:trash";
const INITIAL_MAX = 300;
const FETCH_CONCURRENCY = 8;

/** Absender, auf die man nicht antwortet (für „Antwort erforderlich“). */
const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|mailer-daemon|notifications?@|newsletter|news@|info@.*\.(mailchimp|sendgrid))/i;

export interface SyncResult {
  fetched: number;
  deleted: number;
  mode: "initial" | "delta";
}

export async function syncAccount(account: Account): Promise<SyncResult> {
  let provider: MailProvider;
  try {
    provider = providerFor(account);
    await syncLabels(account, provider);
    const result = account.syncCursor ? await deltaSync(account, provider, account.syncCursor) : await initialSync(account, provider);
    await db
      .update(schema.connectedAccounts)
      .set({ lastSyncedAt: new Date(), lastError: null, status: "active", updatedAt: new Date() })
      .where(eq(schema.connectedAccounts.id, account.id));
    return result;
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await markReauthRequired(account, err.message);
      await audit({ userId: account.userId, accountId: account.id, actor: "system", action: "sync", status: "failed", details: { reason: "reauth_required" } });
    } else {
      await db
        .update(schema.connectedAccounts)
        .set({ lastError: String((err as Error)?.message ?? err), updatedAt: new Date() })
        .where(eq(schema.connectedAccounts.id, account.id));
    }
    throw err;
  }
}

async function initialSync(account: Account, provider: MailProvider): Promise<SyncResult> {
  // Cursor VOR dem Abruf merken, damit währenddessen eingehende Nachrichten im nächsten Delta landen
  const cursor = await provider.currentCursor();
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await provider.listMessageIds({ query: INITIAL_QUERY, pageToken, max: 100 });
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < INITIAL_MAX);
  const fetched = await fetchAndStore(account, provider, ids.slice(0, INITIAL_MAX));
  await db.update(schema.connectedAccounts).set({ syncCursor: cursor }).where(eq(schema.connectedAccounts.id, account.id));
  return { fetched, deleted: 0, mode: "initial" };
}

async function deltaSync(account: Account, provider: MailProvider, cursor: string): Promise<SyncResult> {
  const changes = await provider.changesSince(cursor);
  if (changes.kind === "reset") return initialSync(account, provider);
  const fetched = await fetchAndStore(account, provider, changes.changedMessageIds);
  let deleted = 0;
  if (changes.deletedMessageIds.length) {
    const removed = await db
      .delete(schema.emails)
      .where(and(eq(schema.emails.accountId, account.id), inArray(schema.emails.providerMessageId, changes.deletedMessageIds)))
      .returning({ threadId: schema.emails.threadId });
    deleted = removed.length;
    await refreshThreads(account, [...new Set(removed.map((r) => r.threadId))]);
  }
  await db.update(schema.connectedAccounts).set({ syncCursor: changes.cursor }).where(eq(schema.connectedAccounts.id, account.id));
  return { fetched, deleted, mode: "delta" };
}

async function fetchAndStore(account: Account, provider: MailProvider, ids: string[]): Promise<number> {
  const touchedThreads = new Set<string>();
  let count = 0;
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((id) => provider.getMessage(id)));
    for (const r of results) {
      if (r.status === "rejected") {
        if (r.reason instanceof ReauthRequiredError) throw r.reason;
        // Nachricht zwischenzeitlich gelöscht o. ä. – überspringen, nicht den ganzen Sync abbrechen
        continue;
      }
      touchedThreads.add(await storeMessage(account, r.value));
      count++;
    }
  }
  await refreshThreads(account, [...touchedThreads]);
  return count;
}

/** Speichert/aktualisiert eine Nachricht samt Thread. Gibt die interne Thread-ID zurück. */
export async function storeMessage(account: Account, m: NormalizedMessage): Promise<string> {
  const [thread] = await db
    .insert(schema.emailThreads)
    .values({ userId: account.userId, accountId: account.id, providerThreadId: m.providerThreadId, subject: m.subject, snippet: m.snippet })
    .onConflictDoUpdate({
      target: [schema.emailThreads.accountId, schema.emailThreads.providerThreadId],
      set: { providerThreadId: m.providerThreadId },
    })
    .returning({ id: schema.emailThreads.id });

  const isOutgoing = m.isOutgoing || m.from?.email === account.emailAddress.toLowerCase();
  const values = {
    userId: account.userId,
    accountId: account.id,
    threadId: thread!.id,
    providerMessageId: m.providerMessageId,
    messageIdHeader: m.messageIdHeader,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    snippet: m.snippet,
    bodyText: m.bodyText,
    bodyHtml: m.bodyHtml,
    labelIds: m.labelIds,
    isRead: m.isRead,
    isStarred: m.isStarred,
    isOutgoing,
    receivedAt: m.receivedAt,
  };
  const [email] = await db
    .insert(schema.emails)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.emails.accountId, schema.emails.providerMessageId],
      set: { labelIds: m.labelIds, isRead: m.isRead, isStarred: m.isStarred },
    })
    .returning({ id: schema.emails.id });

  await db.delete(schema.attachments).where(eq(schema.attachments.emailId, email!.id));
  if (m.attachments.length) {
    await db.insert(schema.attachments).values(m.attachments.map((a) => ({ ...a, emailId: email!.id })));
  }

  // Kontakte aus eingehender Kommunikation lernen
  if (!isOutgoing && m.from && !AUTOMATED_SENDER.test(m.from.email)) {
    await db
      .insert(schema.contacts)
      .values({ userId: account.userId, email: m.from.email, name: m.from.name ?? null, source: "email", lastContactAt: m.receivedAt })
      .onConflictDoUpdate({
        target: [schema.contacts.userId, schema.contacts.email],
        set: { lastContactAt: sql`greatest(${schema.contacts.lastContactAt}, excluded.last_contact_at)` },
      });
  }
  return thread!.id;
}

/** Berechnet Thread-Kennzahlen neu: letzte Nachricht, ungelesen, „Antwort erforderlich“, „wartet auf Antwort“. */
export async function refreshThreads(account: Account, threadIds: string[]): Promise<void> {
  for (const threadId of threadIds) {
    const msgs = await db
      .select()
      .from(schema.emails)
      .where(eq(schema.emails.threadId, threadId))
      .orderBy(desc(schema.emails.receivedAt));
    if (!msgs.length) {
      await db.delete(schema.emailThreads).where(eq(schema.emailThreads.id, threadId));
      continue;
    }
    const last = msgs[0]!;
    const inInbox = msgs.some((m) => m.labelIds.includes("INBOX"));
    const lastFromOutside = !last.isOutgoing;
    await db
      .update(schema.emailThreads)
      .set({
        subject: msgs[msgs.length - 1]!.subject ?? last.subject,
        snippet: last.snippet,
        lastMessageAt: last.receivedAt,
        messageCount: msgs.length,
        unread: msgs.some((m) => !m.isRead),
        needsReply: lastFromOutside && inInbox && !AUTOMATED_SENDER.test(last.from?.email ?? "") && !last.labelIds.includes("CATEGORY_PROMOTIONS"),
        awaitingReplySince: last.isOutgoing ? last.receivedAt : null,
      })
      .where(eq(schema.emailThreads.id, threadId));
  }
}

async function syncLabels(account: Account, provider: MailProvider): Promise<void> {
  const labels = await provider.listLabels();
  for (const l of labels) {
    await db
      .insert(schema.labels)
      .values({ accountId: account.id, providerLabelId: l.providerLabelId, name: l.name, kind: l.kind, color: l.color ?? null })
      .onConflictDoUpdate({
        target: [schema.labels.accountId, schema.labels.providerLabelId],
        set: { name: l.name, color: l.color ?? null },
      });
  }
}
