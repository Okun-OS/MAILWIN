import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { decrypt } from "../crypto";
import { appUrl } from "../env";
import { audit } from "../audit";
import { hasFeature } from "../features";
import { enqueue } from "../jobs/queue";
import { OkunCrmClient } from "./okun";
import { CrmError, type CrmConnector, type CrmContact, type CrmLeadInput } from "./types";

export type Integration = typeof schema.integrations.$inferSelect;
export type ThreadLink = typeof schema.crmThreadLinks.$inferSelect;
type Actor = "user" | "marvin" | "automation";

/** Für Tests austauschbar. */
let factory: (i: Integration) => CrmConnector = (i) => new OkunCrmClient(i.baseUrl, decrypt(i.apiKeyEnc));
export function setCrmFactory(f: ((i: Integration) => CrmConnector) | null) {
  factory = f ?? ((i) => new OkunCrmClient(i.baseUrl, decrypt(i.apiKeyEnc)));
}
export const connectorFor = (i: Integration) => factory(i);

/** Die CRM-Integration des Nutzers – null, wenn keine verbunden ist oder der Admin die Funktion abgeschaltet hat. */
export async function getCrmIntegration(userId: string): Promise<Integration | null> {
  const [row] = await db
    .select({ integration: schema.integrations, features: schema.users.features })
    .from(schema.integrations)
    .innerJoin(schema.users, eq(schema.users.id, schema.integrations.userId))
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.kind, "okun_crm")));
  if (!row || !hasFeature({ features: row.features }, "crm")) return null;
  return row.integration;
}

export const threadUrl = (threadId: string) => appUrl(`/emails/${threadId}`).toString();

async function ownedThread(userId: string, threadId: string) {
  const [t] = await db.select().from(schema.emailThreads).where(and(eq(schema.emailThreads.id, threadId), eq(schema.emailThreads.userId, userId)));
  if (!t) throw new Error("Konversation nicht gefunden.");
  return t;
}

/** Gegenüber der Konversation: Absender der ersten eingehenden Nachricht, sonst erster Empfänger. */
export async function threadCounterpart(threadId: string) {
  const msgs = await db.select().from(schema.emails).where(eq(schema.emails.threadId, threadId)).orderBy(asc(schema.emails.receivedAt));
  const incoming = msgs.find((m) => !m.isOutgoing && m.from);
  const person = incoming?.from ?? msgs.find((m) => m.isOutgoing)?.to[0] ?? null;
  return { person, messages: msgs, latestInbound: [...msgs].reverse().find((m) => !m.isOutgoing) ?? null };
}

/** Schlüssel ungültig/widerrufen → Integration als fehlerhaft markieren und Nutzer informieren (einmalig). */
export async function noteCrmError(integration: Integration, err: unknown) {
  if (!(err instanceof CrmError)) return;
  if (err.status === 401 || err.status === 403) {
    if (integration.status !== "error") {
      await db.insert(schema.notifications).values({
        userId: integration.userId,
        kind: "sync_error",
        priority: "high",
        title: "Verbindung zum OKUN CRM unterbrochen",
        body: err.message,
        link: "/einstellungen#integrationen",
      });
    }
    await db.update(schema.integrations).set({ status: "error", lastError: err.message, updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
  }
}

/** CRM-Ansicht einer Konversation: bestehende Verknüpfung oder Treffer zum Gegenüber. */
export async function lookupThread(userId: string, threadId: string) {
  const integration = await getCrmIntegration(userId);
  if (!integration) return null;
  await ownedThread(userId, threadId);
  const [link] = await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, threadId));
  const { person } = await threadCounterpart(threadId);
  let contacts: CrmContact[] = [];
  let error: string | null = null;
  if (person && integration.status === "active") {
    try {
      contacts = await connectorFor(integration).findContacts(person.email);
    } catch (err) {
      await noteCrmError(integration, err);
      error = (err as Error).message;
    }
  }
  return { integration, link: link ?? null, person, contact: contacts[0] ?? null, error };
}

/**
 * Automatische Nachrichten erkennen (ohne Kopfzeilen wie Auto-Submitted, die nicht gespeichert werden):
 * Eine Abwesenheitsnotiz mit leadId würde im CRM als Kundenantwort zählen und das Nachfassen stoppen.
 */
const BOUNCE_SENDER = /^(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT = /^(undeliver(ed|able)|delivery status notification|mail delivery (failed|subsystem)|returned mail|unzustellbar|nicht zustellbar)/i;
const AUTO_SUBJECT = /^(automatische antwort|automatic reply|auto(matic)?[- ]?reply|autoreply|abwesenheits(notiz|meldung)|out of (the )?office|réponse automatique|risposta automatica)\b/i;
const AUTO_BODY = /(dies ist eine automatische antwort|this is an automatic reply|this is an automated (reply|response)|automatisch generierte (nachricht|antwort))/i;

export function automatedKind(email: Pick<typeof schema.emails.$inferSelect, "from" | "subject" | "bodyText" | "isOutgoing">): "bounce" | "auto_reply" | null {
  if (email.isOutgoing) return null;
  const subject = (email.subject ?? "").trim();
  if (BOUNCE_SENDER.test(email.from?.email ?? "") || BOUNCE_SUBJECT.test(subject)) return "bounce";
  if (AUTO_SUBJECT.test(subject) || AUTO_BODY.test((email.bodyText ?? "").slice(0, 600))) return "auto_reply";
  return null;
}

function summaryOf(email: typeof schema.emails.$inferSelect, mode: "preview" | "full") {
  const body = (email.bodyText ?? email.snippet ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (mode === "full") return body.slice(0, 10_000);
  return body.length > 500 ? `${body.slice(0, 500).trimEnd()} …` : body;
}

/**
 * Meldet alle noch nicht gemeldeten Nachrichten einer verknüpften Konversation als Aktivität
 * (nicht im Modus „keine Nachrichten übertragen“).
 * Mit leadId: Das aktive CRM erkennt Kundenantworten und stoppt z. B. Nachfass-Automationen.
 */
export async function logThreadMessages(integration: Integration, link: ThreadLink): Promise<number> {
  if (integration.settings.logMode === "off" || (!link.contactId && !link.leadId)) return 0;
  const msgs = await db.select().from(schema.emails).where(eq(schema.emails.threadId, link.threadId)).orderBy(asc(schema.emails.receivedAt));
  if (!msgs.length) return 0;
  const done = await db
    .select({ emailId: schema.crmActivities.emailId })
    .from(schema.crmActivities)
    .where(and(eq(schema.crmActivities.integrationId, integration.id), inArray(schema.crmActivities.emailId, msgs.map((m) => m.id))));
  const doneIds = new Set(done.map((d) => d.emailId));
  const crm = connectorFor(integration);
  let count = 0;
  for (const m of msgs) {
    if (doneIds.has(m.id)) continue;
    // Unzustellbar-Meldungen gehören nicht in die Zeitleiste; Abwesenheitsnotizen nur zum Kontakt, nie an den Lead
    const automated = automatedKind(m);
    if (automated === "bounce") continue;
    const leadId = automated === "auto_reply" ? null : link.leadId;
    if (!leadId && !link.contactId) continue;
    let res: { id: string };
    try {
      res = await crm.logActivity(
      {
        ...(link.contactId ? { contactId: link.contactId } : {}),
        ...(leadId ? { leadId } : {}),
        type: "email",
        direction: m.isOutgoing ? "outbound" : "inbound",
        subject: m.subject ?? undefined,
        summary: (automated ? "[Automatische Antwort] " : "") + summaryOf(m, integration.settings.content),
        occurredAt: m.receivedAt,
        externalId: `email:${m.id}`,
        url: `${threadUrl(link.threadId)}#m-${m.id}`,
      },
      `activity:${m.id}`,
      );
    } catch (err) {
      // Lead oder Kontakt gibt es im CRM nicht mehr → Zuordnung lösen statt endlos zu wiederholen
      if (err instanceof CrmError && err.status === 404) {
        await db.delete(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, link.threadId));
        await audit({ userId: integration.userId, actor: "system", action: "crm_unlink_thread", targetType: "thread", targetId: link.threadId, status: "success", details: { reason: "not_found_in_crm", leadId: link.leadId } });
        return count;
      }
      throw err;
    }
    await db.insert(schema.crmActivities).values({ integrationId: integration.id, emailId: m.id, activityId: res.id, leadId }).onConflictDoNothing();
    count++;
  }
  return count;
}

async function saveLink(threadId: string, integration: Integration, values: Omit<typeof schema.crmThreadLinks.$inferInsert, "threadId" | "integrationId">) {
  const [row] = await db
    .insert(schema.crmThreadLinks)
    .values({ threadId, integrationId: integration.id, ...values })
    .onConflictDoUpdate({ target: schema.crmThreadLinks.threadId, set: { ...values, integrationId: integration.id, updatedAt: new Date() } })
    .returning();
  return row!;
}

async function requireActive(userId: string) {
  const integration = await getCrmIntegration(userId);
  if (!integration) throw new Error("Es ist kein CRM verbunden.");
  if (integration.status !== "active") throw new Error("Die Verbindung zum CRM ist unterbrochen. Bitte in den Einstellungen prüfen.");
  return integration;
}

/** Ablauf A: Neue Anfrage → Lead (Kontakt und Firma entstehen im CRM bei Bedarf) → Nachrichten als Aktivitäten. */
export async function createLeadForThread(
  userId: string,
  threadId: string,
  input: { title: string; description: string; valueCents?: number; pipelineId?: string; stageId?: string; companyName?: string },
  actor: Actor,
) {
  const integration = await requireActive(userId);
  await ownedThread(userId, threadId);
  const [existing] = await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, threadId));
  if (existing?.leadId) throw new Error("Diese Konversation ist bereits einem Lead zugeordnet.");
  const { person, latestInbound, messages } = await threadCounterpart(threadId);
  if (!person) throw new Error("Für diese Konversation ist kein Gegenüber bekannt.");
  const anchor = latestInbound ?? messages[messages.length - 1];
  const crm = connectorFor(integration);
  const leadInput: CrmLeadInput = {
    contact: { email: person.email, ...(person.name ? { name: person.name } : {}) },
    ...(input.companyName ? { companyName: input.companyName } : {}),
    title: input.title,
    description: input.description,
    ...(input.valueCents ? { valueCents: input.valueCents } : {}),
    ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
    ...(input.stageId ? { stageId: input.stageId } : {}),
    sourceRef: { channel: "email", threadId, messageId: anchor?.id ?? threadId, url: threadUrl(threadId) },
  };
  // Gleicher Inhalt → gleicher Schlüssel (Doppelklick legt nichts doppelt an); geänderter Inhalt ist ein neuer Versuch
  const idempotencyKey = `lead:${anchor?.id ?? threadId}:${createHash("sha256").update(JSON.stringify(leadInput)).digest("hex").slice(0, 16)}`;
  try {
    const lead = await crm.createLead(leadInput, idempotencyKey);
    // Kontakt-ID und Phase für die Verknüpfung nachschlagen (die Antwort enthält nur id + url)
    const [contact] = await crm.findContacts(person.email);
    const open = contact?.openLeads.find((l) => l.id === lead.id);
    const link = await saveLink(threadId, integration, {
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? person.name ?? null,
      contactUrl: contact?.url ?? null,
      leadId: lead.id,
      leadTitle: input.title,
      leadUrl: lead.url,
      leadStage: open?.stage ?? null,
      leadStatus: "open",
      linkedBy: actor === "marvin" ? "marvin" : "user",
    });
    const logged = await logThreadMessages(integration, link);
    await audit({ userId, actor, action: "crm_create_lead", targetType: "thread", targetId: threadId, status: "success", details: { leadId: lead.id, title: input.title, logged } });
    return { lead, link };
  } catch (err) {
    await noteCrmError(integration, err);
    await audit({ userId, actor, action: "crm_create_lead", targetType: "thread", targetId: threadId, status: "failed", details: { error: (err as Error).message } });
    throw err;
  }
}

/** Ablauf B: Konversation einem offenen Lead des Kontakts (oder nur dem Kontakt) zuordnen und Nachrichten melden. */
export async function linkThread(userId: string, threadId: string, leadId: string | null, actor: Actor) {
  const integration = await requireActive(userId);
  await ownedThread(userId, threadId);
  const { person } = await threadCounterpart(threadId);
  if (!person) throw new Error("Für diese Konversation ist kein Gegenüber bekannt.");
  const crm = connectorFor(integration);
  try {
    const contact = (await crm.findContacts(person.email))[0];
    if (!contact) throw new Error(`${person.email} ist im CRM noch nicht als Kontakt vorhanden.`);
    const lead = leadId ? contact.openLeads.find((l) => l.id === leadId) : null;
    if (leadId && !lead) throw new Error("Dieser Lead ist beim Kontakt nicht (mehr) offen.");
    const link = await saveLink(threadId, integration, {
      contactId: contact.id,
      contactName: contact.name,
      contactUrl: contact.url,
      leadId: lead?.id ?? null,
      leadTitle: lead?.title ?? null,
      leadUrl: lead?.url ?? null,
      leadStage: lead?.stage ?? null,
      leadStatus: lead ? "open" : null,
      linkedBy: actor === "marvin" ? "marvin" : actor === "automation" ? "auto" : "user",
    });
    const logged = await logThreadMessages(integration, link);
    await audit({ userId, actor, action: "crm_link_thread", targetType: "thread", targetId: threadId, status: "success", details: { contactId: contact.id, leadId: lead?.id, logged } });
    return link;
  } catch (err) {
    await noteCrmError(integration, err);
    throw err;
  }
}

export async function unlinkThread(userId: string, threadId: string) {
  await ownedThread(userId, threadId);
  await db.delete(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, threadId));
  await audit({ userId, actor: "user", action: "crm_unlink_thread", targetType: "thread", targetId: threadId, status: "success" });
}

/**
 * Hintergrund-Job nach neuen Nachrichten (Abläufe B und C):
 * verknüpfte Konversationen → neue Nachrichten melden; im Modus „alle CRM-Kontakte“ zusätzlich
 * unbekannte Konversationen nachschlagen und – bei genau einem offenen Lead – automatisch zuordnen.
 */
export async function processThreadForCrm(threadId: string): Promise<"skipped" | "logged" | "linked"> {
  const [thread] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.id, threadId));
  if (!thread) return "skipped";
  const integration = await getCrmIntegration(thread.userId);
  if (!integration || integration.status !== "active" || integration.settings.logMode === "off") return "skipped";
  try {
    const [link] = await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, threadId));
    if (link) {
      await logThreadMessages(integration, link);
      return "logged";
    }
    if (integration.settings.logMode !== "known_contacts") return "skipped";
    const { person } = await threadCounterpart(threadId);
    if (!person) return "skipped";
    const contact = (await connectorFor(integration).findContacts(person.email))[0];
    if (!contact) return "skipped";
    // Eindeutiger offener Lead → zuordnen; mehrere → nur Kontakt (der Nutzer wählt in der Konversation)
    const only = contact.openLeads.length === 1 ? contact.openLeads[0]! : null;
    const newLink = await saveLink(threadId, integration, {
      contactId: contact.id,
      contactName: contact.name,
      contactUrl: contact.url,
      leadId: only?.id ?? null,
      leadTitle: only?.title ?? null,
      leadUrl: only?.url ?? null,
      leadStage: only?.stage ?? null,
      leadStatus: only ? "open" : null,
      linkedBy: "auto",
    });
    await logThreadMessages(integration, newLink);
    return "linked";
  } catch (err) {
    await noteCrmError(integration, err);
    throw err;
  }
}

/** Plant die CRM-Verarbeitung geänderter Konversationen ein – nur, wenn ein aktives CRM Nachrichten übernimmt. */
export async function queueCrmProcessing(userId: string, threadIds: string[]) {
  if (!threadIds.length) return;
  const integration = await getCrmIntegration(userId);
  if (!integration || integration.status !== "active" || integration.settings.logMode === "off") return;
  for (const threadId of threadIds) await enqueue("crm_process_thread", { threadId }, { dedupeKey: `crm:${threadId}` });
}
