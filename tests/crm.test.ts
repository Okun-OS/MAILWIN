import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { setProviderFactory } from "@/lib/mail/accounts";
import { syncAccount } from "@/lib/mail/sync";
import { claimNext } from "@/lib/jobs/queue";
import { handlers, PermanentJobError } from "@/lib/jobs/handlers";
import { normalizeBaseUrl, OkunCrmClient } from "@/lib/crm/okun";
import { CrmError } from "@/lib/crm/types";
import { createLeadForThread, getCrmIntegration, linkThread, processThreadForCrm } from "@/lib/crm/service";
import { receiveWebhook, signWebhook } from "@/lib/crm/webhook";
import { executeTool, toolDefinitions } from "@/lib/marvin/tools";
import { createConversation } from "@/lib/marvin/agent";
import { approve } from "@/lib/approvals";
import type { CrmSettings } from "@/lib/db/schema";
import { createUserWithAccount, FakeProvider, message, resetDb } from "./helpers";
import { MOCK_KEY, MockCrm } from "./crm-mock";

const crm = new MockCrm();
let provider: FakeProvider;

beforeAll(async () => {
  await crm.start();
});
afterAll(async () => {
  await crm.stop();
});
beforeEach(async () => {
  await resetDb();
  crm.reset();
  provider = new FakeProvider();
  setProviderFactory(() => provider);
});
afterEach(() => setProviderFactory(null));

const ERIKA = { name: "Erika Muster", email: "erika@beispiel-ag.de" };

/** Nutzer mit Konto, einer eingehenden Anfrage von Erika und verbundenem CRM. */
async function setup(settings: Partial<CrmSettings> = {}, opts: { secret?: string } = {}) {
  const { user, account } = await createUserWithAccount();
  provider.messages.set(
    "m1",
    message({ providerMessageId: "m1", providerThreadId: "t1", from: ERIKA, to: [{ email: account.emailAddress }], subject: "Anfrage Wartungsvertrag", bodyText: "Guten Tag, wir suchen einen Wartungsvertrag für 3 Standorte.", receivedAt: new Date(Date.now() - 3_600_000) }),
  );
  await syncAccount(account);
  const [thread] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.accountId, account.id));
  const [integration] = await db
    .insert(schema.integrations)
    .values({
      userId: user.id,
      kind: "okun_crm",
      baseUrl: crm.baseUrl,
      apiKeyEnc: encrypt(MOCK_KEY),
      workspaceId: "ws_sandbox",
      workspaceName: "Mailwin Sandbox",
      settings: { logMode: "linked", leadMode: "approval", content: "preview", ...settings },
      ...(opts.secret ? { webhookSecretEnc: encrypt(opts.secret) } : {}),
    })
    .returning();
  return { user, account, thread: thread!, integration: integration! };
}

/** Neue Nachricht per Delta-Sync – so wie der Worker sie abruft. */
async function deliver(account: Awaited<ReturnType<typeof setup>>["account"], m: ReturnType<typeof message>) {
  provider.messages.set(m.providerMessageId, m);
  provider.changesSince = async () => ({ kind: "delta", changedMessageIds: [m.providerMessageId], deletedMessageIds: [], cursor: "101" });
  const [fresh] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, account.id));
  await syncAccount(fresh!);
}

async function runJobs() {
  for (let job = await claimNext(); job; job = await claimNext()) await handlers[job.kind]!(job);
}

describe("OKUN-CRM-Client (Connect API v1)", () => {
  it("normalisiert die Adresse und verlangt https", () => {
    expect(normalizeBaseUrl("https://crm.okun-systems.com/")).toBe("https://crm.okun-systems.com/api/mailwin/v1");
    expect(normalizeBaseUrl("https://crm.okun-systems.com/api/mailwin/v1/")).toBe("https://crm.okun-systems.com/api/mailwin/v1");
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000/api/mailwin/v1");
    expect(() => normalizeBaseUrl("http://crm.example.com")).toThrow(/https/);
  });

  it("prüft den Schlüssel, übersetzt Fehler und erkennt Wiederholbares", async () => {
    expect((await new OkunCrmClient(crm.baseUrl, MOCK_KEY).me()).name).toBe("Mailwin Sandbox");

    const wrong = await new OkunCrmClient(crm.baseUrl, "okun_mw_falsch").me().catch((e) => e);
    expect(wrong).toBeInstanceOf(CrmError);
    expect([wrong.status, wrong.code, wrong.retryable]).toEqual([401, "unauthorized", false]);

    crm.rateLimitNext = 1;
    const limited = await new OkunCrmClient(crm.baseUrl, MOCK_KEY).pipelines().catch((e) => e);
    expect([limited.status, limited.retryAfterSeconds, limited.retryable]).toEqual([429, 7, true]);

    const invalid = await new OkunCrmClient(crm.baseUrl, MOCK_KEY)
      .logActivity({ type: "email", direction: "inbound", summary: "x", occurredAt: new Date(), externalId: "e1", url: "https://okun-mailwin.com/emails/1" })
      .catch((e) => e);
    expect([invalid.status, invalid.code]).toEqual([422, "validation_failed"]);
    expect(invalid.fields).toHaveProperty("contactId");

    const offline = await new OkunCrmClient("http://127.0.0.1:1/api/mailwin/v1", MOCK_KEY).me().catch((e) => e);
    expect([offline.status, offline.retryable]).toEqual([0, true]);
  });
});

describe("Ablauf A – neue Anfrage wird Lead", () => {
  it("legt Lead samt Kontakt an, verknüpft die Konversation und protokolliert die Anfrage am Lead", async () => {
    const { user, thread } = await setup();
    const { lead, link } = await createLeadForThread(user.id, thread.id, { title: "Anfrage: Wartungsvertrag 3 Standorte", description: "3 Standorte", valueCents: 2_400_000 }, "user");

    const deal = crm.deals.find((d) => d.id === lead.id)!;
    expect(deal.sourceRef).toMatchObject({ channel: "email", threadId: thread.id, url: `http://localhost:3000/emails/${thread.id}` });
    expect(crm.contacts.map((c) => c.email)).toEqual([ERIKA.email]); // Kontakt vom CRM angelegt
    expect(link).toMatchObject({ leadId: lead.id, leadStage: "Lead", leadStatus: "open", contactName: "Erika Muster" });

    const leadCall = crm.requests.find((r) => r.method === "POST" && r.path === "/leads")!;
    expect(leadCall.body).toMatchObject({ source: "mailwin", contact: ERIKA, valueCents: 2_400_000 });
    expect(leadCall.headers["idempotency-key"]).toMatch(/^lead:/);

    const [activity] = [...crm.activities.values()];
    expect(activity!.body).toMatchObject({ leadId: lead.id, contactId: link.contactId, type: "email", direction: "inbound", subject: "Anfrage Wartungsvertrag" });
    expect(String(activity!.body.occurredAt)).toMatch(/Z$/);
    expect(await db.select().from(schema.crmActivities)).toHaveLength(1);

    await expect(createLeadForThread(user.id, thread.id, { title: "Nochmal", description: "" }, "user")).rejects.toThrow(/bereits/);
  });

  it("legt bei wiederholtem Aufruf mit gleichem Inhalt keinen zweiten Lead an (Idempotency-Key)", async () => {
    const { user, thread } = await setup();
    await createLeadForThread(user.id, thread.id, { title: "Anfrage", description: "" }, "user");
    // Verknüpfung verloren (z. B. Abbruch) → gleicher Versuch erneut
    await db.delete(schema.crmThreadLinks);
    await createLeadForThread(user.id, thread.id, { title: "Anfrage", description: "" }, "user");
    expect(crm.deals).toHaveLength(1);
  });

  it("Marvin schlägt den Lead zur Freigabe vor; erst die Freigabe legt ihn an", async () => {
    const { user, thread } = await setup();
    const conversation = await createConversation(user.id);
    const ctx = { userId: user.id, conversationId: conversation.id, toolUseId: "tu_1" };

    const res = await executeTool(ctx, "crm_create_lead", { thread_id: thread.id, title: "Wartungsvertrag", description: "3 Standorte", value_eur: 24000 });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content).status).toBe("wartet_auf_freigabe");
    expect(crm.deals).toHaveLength(0);

    const [approval] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.userId, user.id));
    const result = await approve(user.id, approval!.id, { title: "Wartungsvertrag 3 Standorte" });
    expect(result.ok).toBe(true);
    expect(crm.deals.map((d) => [d.title, d.valueCents])).toEqual([["Wartungsvertrag 3 Standorte", 2_400_000]]);
  });

  it("legt im Modus „direkt“ sofort an und bietet CRM-Werkzeuge nur mit Verbindung an", async () => {
    const { user, thread } = await setup({ leadMode: "direct" });
    const conversation = await createConversation(user.id);
    const res = await executeTool({ userId: user.id, conversationId: conversation.id, toolUseId: "tu" }, "crm_create_lead", { thread_id: thread.id, title: "Direkt", description: "" });
    expect(JSON.parse(res.content).ok).toBe(true);
    expect(crm.deals).toHaveLength(1);

    const names = (crm: boolean) => toolDefinitions({ webSearch: false, crm }).map((t) => (t as { name: string }).name);
    expect(names(false)).not.toContain("crm_lookup");
    expect(names(true)).toEqual(expect.arrayContaining(["crm_lookup", "crm_create_lead", "crm_link_thread"]));
  });
});

describe("Abläufe B und C – Folge-Nachrichten am Lead", () => {
  it("meldet neue ein- und ausgehende Nachrichten einer verknüpften Konversation genau einmal", async () => {
    const { user, account, thread } = await setup();
    const [contact] = [crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Rahmenvertrag 2027" }], "Beispiel AG")];
    const leadId = crm.deals[0]!.id;
    await linkThread(user.id, thread.id, leadId, "user");
    expect(crm.activities.size).toBe(1);

    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, subject: "Re: Anfrage Wartungsvertrag", bodyText: "Passt Dienstag?" }));
    await deliver(account, message({ providerMessageId: "m3", providerThreadId: "t1", from: { email: account.emailAddress }, to: [ERIKA], isOutgoing: true, subject: "Re: Anfrage", bodyText: "Ja, gern." }));
    await runJobs();
    await runJobs(); // erneute Verarbeitung meldet nichts doppelt

    const bodies = [...crm.activities.values()].map((a) => a.body);
    expect(bodies.map((b) => [b.direction, b.leadId, b.contactId])).toEqual([
      ["inbound", leadId, contact!.id],
      ["inbound", leadId, contact!.id],
      ["outbound", leadId, contact!.id],
    ]);
    expect(crm.requests.filter((r) => r.path === "/activities")).toHaveLength(3);
  });

  it("meldet Abwesenheitsnotizen nur am Kontakt (stoppt kein Nachfassen) und Unzustellbar-Meldungen gar nicht", async () => {
    const { user, account, thread } = await setup();
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    const leadId = crm.deals[0]!.id;
    await linkThread(user.id, thread.id, leadId, "user");
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, subject: "Automatische Antwort: Anfrage Wartungsvertrag", bodyText: "Ich bin bis 10.11. nicht im Büro." }));
    await deliver(account, message({ providerMessageId: "m3", providerThreadId: "t1", from: ERIKA, subject: "Re: Anfrage", bodyText: "Dies ist eine automatische Antwort. Ihre Nachricht ist eingegangen." }));
    await deliver(account, message({ providerMessageId: "m4", providerThreadId: "t1", from: { email: "MAILER-DAEMON@mail.test" }, subject: "Undelivered Mail Returned to Sender" }));
    await runJobs();
    const bodies = [...crm.activities.values()].map((a) => a.body);
    expect(bodies).toHaveLength(3);
    expect(bodies.slice(1).every((b) => !b.leadId && b.contactId && String(b.summary).startsWith("[Automatische Antwort]"))).toBe(true);
    expect(String(bodies[0]!.url)).toMatch(new RegExp(`/emails/${thread.id}#m-`));
  });

  it("überträgt standardmäßig nur eine Vorschau, auf Wunsch den vollen Text, im Modus „aus“ nichts", async () => {
    const long = "A".repeat(2000);
    const preview = await setup();
    await deliver(preview.account, message({ providerMessageId: "m9", providerThreadId: "t1", from: ERIKA, bodyText: long }));
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(preview.user.id, preview.thread.id, crm.deals[0]!.id, "user");
    const summaries = [...crm.activities.values()].map((a) => String(a.body.summary).length);
    expect(Math.max(...summaries)).toBeLessThan(520);

    await resetDb();
    crm.reset();
    const full = await setup({ content: "full" });
    await deliver(full.account, message({ providerMessageId: "m9", providerThreadId: "t1", from: ERIKA, bodyText: long }));
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(full.user.id, full.thread.id, crm.deals[0]!.id, "user");
    expect(Math.max(...[...crm.activities.values()].map((a) => String(a.body.summary).length))).toBe(2000);

    await resetDb();
    crm.reset();
    const off = await setup({ logMode: "off" });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(off.user.id, off.thread.id, crm.deals[0]!.id, "user");
    expect(crm.activities.size).toBe(0);
    expect(await processThreadForCrm(off.thread.id)).toBe("skipped");
  });

  it("ordnet im Modus „alle CRM-Kontakte“ bei genau einem offenen Lead automatisch zu, sonst nur dem Kontakt", async () => {
    const one = await setup({ logMode: "known_contacts" });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Rahmenvertrag 2027" }]);
    await deliver(one.account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, bodyText: "Rückfrage" }));
    await runJobs();
    const [link] = await db.select().from(schema.crmThreadLinks);
    expect(link).toMatchObject({ leadTitle: "Rahmenvertrag 2027", linkedBy: "auto" });
    expect(crm.activities.size).toBe(2);

    await resetDb();
    crm.reset();
    const two = await setup({ logMode: "known_contacts" });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Rahmenvertrag 2027" }, { title: "Zusatzauftrag" }]);
    await deliver(two.account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, bodyText: "Rückfrage" }));
    await runJobs();
    const [contactOnly] = await db.select().from(schema.crmThreadLinks);
    expect(contactOnly).toMatchObject({ leadId: null, linkedBy: "auto" });
    expect([...crm.activities.values()].every((a) => !a.body.leadId && a.body.contactId)).toBe(true);
  });

  it("ohne verknüpfte Konversation (Modus „zugeordnet“) wird nichts übertragen", async () => {
    const { account } = await setup();
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA }));
    await runJobs();
    expect(crm.requests).toHaveLength(0);
  });

  it("widerrufener Schlüssel: Integration wird als unterbrochen markiert, Job endet ohne Wiederholung", async () => {
    const { user, account, thread } = await setup();
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(user.id, thread.id, crm.deals[0]!.id, "user");
    crm.revoked = true;
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA }));
    const job = (await claimNext())!;
    await expect(handlers[job.kind]!(job)).rejects.toBeInstanceOf(PermanentJobError);
    const [integration] = await db.select().from(schema.integrations);
    expect(integration!.status).toBe("error");
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notes.some((n) => n.title.includes("CRM"))).toBe(true);
  });

  it("gelöschter Lead im CRM (404) löst die Zuordnung statt endlos zu wiederholen", async () => {
    const { user, account, thread } = await setup();
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(user.id, thread.id, crm.deals[0]!.id, "user");
    crm.deals = [];
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA }));
    await runJobs();
    expect(await db.select().from(schema.crmThreadLinks)).toHaveLength(0);
  });

  it("ist die Funktion vom Admin abgeschaltet, gibt es keine CRM-Integration", async () => {
    const { user } = await setup();
    await db.update(schema.users).set({ features: { crm: false } }).where(eq(schema.users.id, user.id));
    expect(await getCrmIntegration(user.id)).toBeNull();
  });
});

describe("Ablauf D – Webhooks des CRM", () => {
  const SECRET = "whsec_test_geheimnis_1234567890";

  function delivery(event: Record<string, unknown>, opts: { secret?: string; ts?: number } = {}) {
    const raw = JSON.stringify(event);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const headers = new Headers({ "x-okun-timestamp": ts, "x-okun-signature": signWebhook(raw, ts, opts.secret ?? SECRET), "x-okun-event": String(event.type) });
    return { raw, headers };
  }

  const leadEvent = (type: string, leadId: string, stage: { id: string; name: string; type?: string }, status: string, occurredAt: string, extra: Record<string, unknown> = {}) => ({
    id: `evt_${type}_${occurredAt}`,
    type,
    occurredAt,
    data: { lead: { id: leadId, title: "Rahmenvertrag 2027", url: `${crm.appUrl}/deals/${leadId}`, stage, status, contacts: [], sourceRef: null, ...extra }, previousStage: { id: "st_qual", name: "Qualifiziert" } },
  });

  async function linkedSetup() {
    const s = await setup({}, { secret: SECRET });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Rahmenvertrag 2027" }]);
    const leadId = crm.deals[0]!.id;
    await linkThread(s.user.id, s.thread.id, leadId, "user");
    return { ...s, leadId };
  }

  it("übernimmt Phasenwechsel, meldet „gewonnen“, beendet Nachfass-Erinnerungen und verarbeitet jedes Ereignis einmal", async () => {
    const { user, thread, integration, leadId } = await linkedSetup();
    await db.insert(schema.scheduledFollowUps).values({ userId: user.id, threadId: thread.id, dueAt: new Date(Date.now() + 86_400_000) });

    const t = new Date().toISOString();
    const stage = delivery(leadEvent("lead.stage_changed", leadId, { id: "st_won", name: "Gewonnen", type: "won" }, "won", t));
    const won = delivery(leadEvent("lead.won", leadId, { id: "st_won", name: "Gewonnen", type: "won" }, "won", t));
    expect((await receiveWebhook(stage.raw, stage.headers, null)).status).toBe(200);
    expect((await receiveWebhook(won.raw, won.headers, integration.id)).status).toBe(200);
    const again = await receiveWebhook(won.raw, won.headers, null);
    expect(again).toEqual({ status: 200, body: { ok: true, duplicate: true } });

    const [link] = await db.select().from(schema.crmThreadLinks);
    expect(link).toMatchObject({ leadStage: "Gewonnen", leadStatus: "won" });
    const notes = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.kind, "crm_update")));
    expect(notes.map((n) => n.title)).toEqual(["Gewonnen: Rahmenvertrag 2027"]);
    const [followUp] = await db.select().from(schema.scheduledFollowUps);
    expect(followUp!.status).toBe("cancelled");
    expect((await db.select().from(schema.integrations))[0]!.lastWebhookAt).not.toBeNull();
  });

  it("ein verspätet zugestelltes älteres Ereignis überschreibt keine neuere Phase", async () => {
    const { leadId } = await linkedSetup();
    const newer = delivery(leadEvent("lead.stage_changed", leadId, { id: "st_angebot", name: "Angebot" }, "open", "2026-10-30T12:00:00Z"));
    const older = delivery(leadEvent("lead.stage_changed", leadId, { id: "st_qual", name: "Qualifiziert" }, "open", "2026-10-30T11:00:00Z"));
    await receiveWebhook(newer.raw, newer.headers, null);
    await receiveWebhook(older.raw, older.headers, null);
    expect((await db.select().from(schema.crmThreadLinks))[0]!.leadStage).toBe("Angebot");
  });

  it("weist falsche Signaturen, alte Zeitstempel und fremde Integrationen ab", async () => {
    const { leadId, integration } = await linkedSetup();
    const event = leadEvent("lead.lost", leadId, { id: "st_lost", name: "Verloren", type: "lost" }, "lost", new Date().toISOString());

    const forged = delivery(event, { secret: "falsches_geheimnis_123456" });
    expect((await receiveWebhook(forged.raw, forged.headers, null)).status).toBe(401);

    const stale = delivery(event, { ts: Math.floor(Date.now() / 1000) - 301 });
    expect((await receiveWebhook(stale.raw, stale.headers, null)).status).toBe(401);

    const ok = delivery(event);
    const tampered = ok.raw.replace("Verloren", "Gewonnen");
    expect((await receiveWebhook(tampered, ok.headers, null)).status).toBe(401);
    expect((await receiveWebhook(ok.raw, ok.headers, "00000000-0000-4000-8000-000000000000")).status).toBe(401);
    expect((await receiveWebhook(ok.raw, new Headers(), integration.id)).status).toBe(400);

    expect((await db.select().from(schema.crmThreadLinks))[0]!.leadStatus).toBe("open");
  });

  it("holt die Zuordnung für einen aus Mailwin angelegten Lead nach und übernimmt Kontaktänderungen", async () => {
    const { user, thread } = await setup({}, { secret: SECRET });
    const event = leadEvent("lead.stage_changed", "dl_extern", { id: "st_qual", name: "Qualifiziert" }, "open", new Date().toISOString(), {
      contacts: [{ id: "ct_9", name: "Erika Muster", email: ERIKA.email, isPrimary: true }],
      sourceRef: { system: "mailwin", channel: "email", threadId: thread.id, messageId: "x", url: "https://okun-mailwin.com" },
    });
    const d = delivery(event);
    expect((await receiveWebhook(d.raw, d.headers, null)).status).toBe(200);
    const [link] = await db.select().from(schema.crmThreadLinks);
    expect(link).toMatchObject({ leadId: "dl_extern", contactId: "ct_9", leadStage: "Qualifiziert" });

    const contact = delivery({ id: "evt_c1", type: "contact.updated", occurredAt: new Date().toISOString(), data: { contact: { id: "ct_9", name: "Dr. Erika Muster", email: ERIKA.email, url: "https://crm/contacts/ct_9" }, changed: ["name"] } });
    await receiveWebhook(contact.raw, contact.headers, null);
    expect((await db.select().from(schema.crmThreadLinks))[0]!.contactName).toBe("Dr. Erika Muster");
    const [local] = await db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id));
    expect(local!.name).toBe("Dr. Erika Muster");

    const ping = delivery({ id: "evt_p", type: "ping", occurredAt: new Date().toISOString(), data: { workspaceId: "ws_sandbox", message: "Test" } });
    expect((await receiveWebhook(ping.raw, ping.headers, null)).status).toBe(200);
  });
});
