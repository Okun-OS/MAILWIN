import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { decrypt } from "../crypto";
import type { Integration } from "./service";

/** Zeitfenster gegen Wiederholungsangriffe (Übergabe: 5 Minuten). */
export const MAX_SKEW_SECONDS = 300;

export function signWebhook(rawBody: string, timestamp: string, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string, secret: string, nowSeconds = Date.now() / 1000) {
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signWebhook(rawBody, timestamp, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const stage = z.object({ id: z.string(), name: z.string() }).passthrough();
const leadEvent = z.object({
  lead: z
    .object({
      id: z.string(),
      title: z.string(),
      url: z.string().nullish(),
      stage: stage.extend({ type: z.string().nullish() }),
      status: z.enum(["open", "won", "lost"]),
      lostReason: z.string().nullish(),
      contacts: z.array(z.object({ id: z.string(), name: z.string().nullish(), email: z.string().nullish(), isPrimary: z.boolean().nullish() })).default([]),
      sourceRef: z.object({ system: z.string().nullish(), channel: z.string().nullish(), threadId: z.string().nullish() }).passthrough().nullish(),
    })
    .passthrough(),
  previousStage: stage.nullish(),
});
const contactEvent = z.object({
  contact: z.object({ id: z.string(), name: z.string().nullish(), email: z.string().nullish(), url: z.string().nullish() }).passthrough(),
  changed: z.array(z.string()).default([]),
});
const envelope = z.object({ id: z.string().min(1).max(200), type: z.string(), occurredAt: z.string(), data: z.unknown() });

export type WebhookResult = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nimmt ein Webhook des OKUN CRM an (Ablauf D).
 * Gesucht wird die Integration, deren Geheimnis die Signatur bestätigt – mit `?i=<id>` direkt, sonst unter allen
 * Integrationen mit hinterlegtem Geheimnis (die Standard-URL des CRM enthält keine Kennung).
 */
export async function receiveWebhook(rawBody: string, headers: Headers, integrationHint: string | null): Promise<WebhookResult> {
  const timestamp = headers.get("x-okun-timestamp") ?? "";
  const signature = headers.get("x-okun-signature") ?? "";
  if (!timestamp || !signature) return { status: 400, body: { error: "missing_signature" } };

  const conds = [eq(schema.integrations.kind, "okun_crm"), sql`${schema.integrations.webhookSecretEnc} is not null`];
  if (integrationHint) {
    if (!UUID.test(integrationHint)) return { status: 401, body: { error: "invalid_signature" } };
    conds.push(eq(schema.integrations.id, integrationHint));
  }
  const candidates = await db.select().from(schema.integrations).where(and(...conds));
  const verified = candidates.filter((i) => {
    try {
      return verifyWebhookSignature(rawBody, timestamp, signature, decrypt(i.webhookSecretEnc!));
    } catch {
      return false;
    }
  });
  if (!verified.length) return { status: 401, body: { error: "invalid_signature" } };

  let event: z.infer<typeof envelope>;
  try {
    event = envelope.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return { status: 400, body: { error: "invalid_payload" } };

  let processed = 0;
  for (const integration of verified) {
    await db.update(schema.integrations).set({ lastWebhookAt: new Date() }).where(eq(schema.integrations.id, integration.id));
    const fresh = await db
      .insert(schema.webhookEvents)
      .values({ id: `${integration.id}:${event.id}`, integrationId: integration.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (!fresh.length) continue; // bereits verarbeitet – Zustellung wird nur bestätigt
    try {
      await applyEvent(integration, event.type, event.data, occurredAt);
      processed++;
    } catch (err) {
      // Nicht verarbeitet → Eintrag zurücknehmen, damit die Wiederholung des CRM greift
      await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.id, `${integration.id}:${event.id}`));
      if (err instanceof z.ZodError) return { status: 400, body: { error: "invalid_payload" } };
      throw err;
    }
  }
  return { status: 200, body: { ok: true, ...(processed ? {} : { duplicate: true }) } };
}

async function applyEvent(integration: Integration, type: string, data: unknown, occurredAt: Date) {
  switch (type) {
    case "lead.stage_changed":
    case "lead.won":
    case "lead.lost":
      return applyLeadEvent(integration, type, leadEvent.parse(data), occurredAt);
    case "contact.updated":
      return applyContactEvent(integration, contactEvent.parse(data));
    default:
      // ping und künftige Ereignisse: annehmen, nichts tun
      return;
  }
}

async function applyLeadEvent(integration: Integration, type: string, data: z.infer<typeof leadEvent>, occurredAt: Date) {
  const { lead } = data;
  const values = { leadTitle: lead.title, leadUrl: lead.url ?? null, leadStage: lead.stage.name, leadStatus: lead.status, leadEventAt: occurredAt, updatedAt: new Date() };
  // Gleicher Zeitpunkt zählt als neuer: Ein Wechsel nach „Gewonnen“ meldet lead.stage_changed und lead.won zugleich
  const notOlder = or(isNull(schema.crmThreadLinks.leadEventAt), lte(schema.crmThreadLinks.leadEventAt, occurredAt));
  const ofLead = and(eq(schema.crmThreadLinks.integrationId, integration.id), eq(schema.crmThreadLinks.leadId, lead.id));
  await db.update(schema.crmThreadLinks).set(values).where(and(ofLead, notOlder));
  let threadIds = (await db.select({ threadId: schema.crmThreadLinks.threadId }).from(schema.crmThreadLinks).where(ofLead)).map((r) => r.threadId);

  // Aus Mailwin angelegter Lead ohne gespeicherte Zuordnung (z. B. Abbruch nach dem Anlegen) → Zuordnung nachholen
  const ref = lead.sourceRef;
  if (!threadIds.length && ref?.system === "mailwin" && ref.threadId && UUID.test(ref.threadId)) {
    const [thread] = await db
      .select({ id: schema.emailThreads.id })
      .from(schema.emailThreads)
      .where(and(eq(schema.emailThreads.id, ref.threadId), eq(schema.emailThreads.userId, integration.userId)));
    const [existing] = thread ? await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, thread.id)) : [];
    if (thread && !existing?.leadId) {
      const primary = lead.contacts.find((c) => c.isPrimary) ?? lead.contacts[0];
      await db
        .insert(schema.crmThreadLinks)
        .values({ threadId: thread.id, integrationId: integration.id, leadId: lead.id, contactId: primary?.id ?? null, contactName: primary?.name ?? null, linkedBy: "auto", ...values })
        .onConflictDoUpdate({ target: schema.crmThreadLinks.threadId, set: { leadId: lead.id, ...values } });
      threadIds = [thread.id];
    }
  }
  if (!threadIds.length || type === "lead.stage_changed") return;

  // Gewonnen/verloren: Nutzer informieren, geplante Nachfass-Erinnerungen in Mailwin beenden
  const won = type === "lead.won";
  await db.insert(schema.notifications).values({
    userId: integration.userId,
    kind: "crm_update",
    priority: won ? "high" : "normal",
    title: won ? `Gewonnen: ${lead.title}` : `Verloren: ${lead.title}`,
    body: won ? "Der Lead wurde im CRM als gewonnen markiert. Geplante Nachfass-Erinnerungen sind beendet." : `Der Lead wurde im CRM als verloren markiert${lead.lostReason ? ` (${lead.lostReason})` : ""}. Geplante Nachfass-Erinnerungen sind beendet.`,
    link: `/emails/${threadIds[0]}`,
  });
  await db
    .update(schema.scheduledFollowUps)
    .set({ status: "cancelled" })
    .where(and(eq(schema.scheduledFollowUps.userId, integration.userId), inArray(schema.scheduledFollowUps.threadId, threadIds), eq(schema.scheduledFollowUps.status, "scheduled")));
}

async function applyContactEvent(integration: Integration, data: z.infer<typeof contactEvent>) {
  const { contact } = data;
  await db
    .update(schema.crmThreadLinks)
    .set({ contactName: contact.name ?? null, contactUrl: contact.url ?? null, updatedAt: new Date() })
    .where(and(eq(schema.crmThreadLinks.integrationId, integration.id), eq(schema.crmThreadLinks.contactId, contact.id)));
  // Namen im Mailwin-Adressbuch nachziehen (die E-Mail-Adresse bleibt der Schlüssel)
  if (contact.email && contact.name) {
    await db
      .update(schema.contacts)
      .set({ name: contact.name })
      .where(and(eq(schema.contacts.userId, integration.userId), sql`lower(${schema.contacts.email}) = ${contact.email.toLowerCase()}`));
  }
}

/** Alte Ereignis-IDs aufräumen: Das CRM wiederholt höchstens 24 Stunden lang. */
export async function pruneWebhookEvents(days = 7) {
  await db.delete(schema.webhookEvents).where(lt(schema.webhookEvents.receivedAt, new Date(Date.now() - days * 86_400_000)));
}
