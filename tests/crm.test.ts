import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { setProviderFactory } from "@/lib/mail/accounts";
import { syncAccount } from "@/lib/mail/sync";
import { claimNext, complete } from "@/lib/jobs/queue";
import { handlers, PermanentJobError } from "@/lib/jobs/handlers";
import { normalizeBaseUrl, OkunCrmClient } from "@/lib/crm/okun";
import { CrmError } from "@/lib/crm/types";
import { analyzeThreadSignals, createLeadForThread, getCrmIntegration, linkThread, logThreadMessages, processThreadForCrm, sendPendingSignals } from "@/lib/crm/service";
import { EMPTY_ANALYSIS, needsAnalysis, outOfOfficeUntil, sanitize, setSignalClassifier, type Analysis, type MessageForAnalysis } from "@/lib/crm/signals";
import { setAiConfigured } from "@/lib/ai";
import { setModelCaller } from "@/lib/marvin/agent";
import type Anthropic from "@anthropic-ai/sdk";
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
/** Ersetzt die Einordnung durch Claude; zeichnet auf, welche Nachrichten eingeordnet wurden. */
let classified: MessageForAnalysis[] = [];
function classifyWith(fn: (m: MessageForAnalysis) => Analysis) {
  setSignalClassifier(async (m) => {
    classified.push(m);
    return fn(m);
  });
}

beforeEach(async () => {
  await resetDb();
  crm.reset();
  provider = new FakeProvider();
  setProviderFactory(() => provider);
  classified = [];
  setAiConfigured(true);
  classifyWith(() => EMPTY_ANALYSIS);
});
afterEach(() => {
  setProviderFactory(null);
  setSignalClassifier(null);
  setAiConfigured(null);
  setModelCaller(null);
});

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

/** Wie der Worker: Job ausführen und als erledigt markieren. */
async function runJobs() {
  for (let job = await claimNext(); job; job = await claimNext()) {
    await handlers[job.kind]!(job);
    await complete(job.id);
  }
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

  it("meldet Abwesenheitsnotizen am Lead als Signal out_of_office (keine Kundenantwort) und Unzustellbar-Meldungen gar nicht", async () => {
    const { user, account, thread } = await setup();
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    const leadId = crm.deals[0]!.id;
    await linkThread(user.id, thread.id, leadId, "user");
    const at = new Date("2026-11-08T09:00:00Z");
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, subject: "Automatische Antwort: Anfrage Wartungsvertrag", bodyText: "Ich bin bis 10.11. nicht im Büro.", receivedAt: at }));
    await deliver(account, message({ providerMessageId: "m3", providerThreadId: "t1", from: ERIKA, subject: "Re: Anfrage", bodyText: "Dies ist eine automatische Antwort. Ihre Nachricht ist eingegangen.", receivedAt: at }));
    await deliver(account, message({ providerMessageId: "m4", providerThreadId: "t1", from: { email: "MAILER-DAEMON@mail.test" }, subject: "Undelivered Mail Returned to Sender" }));
    await runJobs();

    expect(crm.activities.size).toBe(1); // nur die ursprüngliche Anfrage – keine Aktivität mit leadId für Abwesenheit
    expect(crm.signals.map((x) => x.body.signal)).toEqual(["out_of_office", "out_of_office"]);
    const first = crm.signals[0]!.body as { data?: { until?: string }; evidence?: { quote?: string }; url: string };
    expect(first.data?.until).toBe("2026-11-10T23:59:00+01:00");
    expect(first.evidence?.quote).toBe("Ich bin bis 10.11. nicht im Büro.");
    expect(first.url).toMatch(new RegExp(`/emails/${thread.id}#m-`));
    expect((crm.signals[1]!.body as { data?: unknown }).data).toBeUndefined(); // ohne Datum: das CRM pausiert 7 Tage
    expect(classified).toHaveLength(1); // nur die Anfrage wird eingeordnet, Automatisches nie
  });

  it("ohne Signale: Abwesenheitsnotizen nur am Kontakt, Unzustellbar-Meldungen gar nicht", async () => {
    const { user, account, thread } = await setup({ signals: "off" });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Lead" }]);
    await linkThread(user.id, thread.id, crm.deals[0]!.id, "user");
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, subject: "Automatische Antwort: Anfrage", bodyText: "Ich bin bis 10.11. nicht im Büro." }));
    await deliver(account, message({ providerMessageId: "m4", providerThreadId: "t1", from: { email: "MAILER-DAEMON@mail.test" }, subject: "Undelivered Mail Returned to Sender" }));
    await runJobs();
    const bodies = [...crm.activities.values()].map((a) => a.body);
    expect(bodies).toHaveLength(2);
    expect(!bodies[1]!.leadId && bodies[1]!.contactId && String(bodies[1]!.summary).startsWith("[Automatische Antwort]")).toBe(true);
    expect(crm.signals).toHaveLength(0);
    expect(classified).toHaveLength(0);
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

const raw = (signals: Partial<Analysis["signals"][number] & Record<string, unknown>>[]) => ({ signals, task: null, contact_details: null }) as never;
const msg = (over: Partial<MessageForAnalysis> = {}): MessageForAnalysis => ({
  direction: "inbound",
  subject: "Re: Angebot",
  body: "Guten Tag, wir nehmen Ihr Angebot an. Bitte rufen Sie mich am Dienstag an.",
  attachments: [],
  receivedAt: new Date("2026-11-08T09:00:00Z"),
  timezone: "Europe/Berlin",
  leadTitle: "Rahmenvertrag 2027",
  ...over,
});
const sig = (signal: string, confidence: number, quote: string, extra: Record<string, unknown> = {}) => ({
  signal,
  confidence,
  quote,
  summary: "…",
  offer_number: null,
  value_eur: null,
  valid_until: null,
  start_at: null,
  end_at: null,
  until: null,
  reason: null,
  ...extra,
});

describe("Signal-Erkennung (Regeln)", () => {
  it("prüft Richtung, Schwelle 0,6, wörtliche Zitate und Termine", () => {
    const out = sanitize(
      raw([
        sig("offer_accepted", 0.92, "wir nehmen Ihr Angebot an"),
        sig("offer_accepted", 0.7, "wir nehmen Ihr Angebot an"), // schwächeres Duplikat
        sig("question", 0.55, "Bitte rufen Sie mich am Dienstag an."), // unter der Schwelle
        sig("offer_sent", 0.95, "wir nehmen Ihr Angebot an"), // falsche Richtung
        sig("meeting_booked", 0.9, "am Dienstag"), // ohne Zeitpunkt kein gebuchter Termin
        sig("meeting_requested", 0.8, "Wir möchten Sie gern zum Essen einladen"), // erfundenes Zitat
      ] as never),
      msg(),
    );
    expect(out.signals.map((x) => [x.signal, x.confidence, x.quote])).toEqual([
      ["offer_accepted", 0.92, "wir nehmen Ihr Angebot an"],
      ["meeting_requested", 0.8, undefined],
    ]);
  });

  it("übernimmt Angebotsdaten nur in gültiger Form", () => {
    const out = sanitize(
      raw([sig("offer_sent", 0.9, "anbei unser Angebot", { offer_number: "2026-117", value_eur: 24000, valid_until: "2026-11-30", start_at: "morgen" })] as never),
      msg({ direction: "outbound", body: "Hallo Frau Muster, anbei unser Angebot Nr. 2026-117." }),
    );
    expect(out.signals[0]!.data).toEqual({ offerNumber: "2026-117", valueCents: 2_400_000, validUntil: "2026-11-30" });
  });

  it("Vorfilter: ausgehend nur bei Angebot, Vertrag oder Terminbestätigung", () => {
    expect(needsAnalysis(msg())).toBe(true);
    expect(needsAnalysis(msg({ direction: "outbound", body: "Danke für das nette Gespräch!" }))).toBe(false);
    expect(needsAnalysis(msg({ direction: "outbound", body: "Siehe Anhang.", attachments: ["Angebot_2026-117.pdf"] }))).toBe(true);
    expect(needsAnalysis(msg({ direction: "outbound", body: "Anbei sende ich Ihnen unser Angebot." }))).toBe(true);
    expect(needsAnalysis(msg({ direction: "outbound", body: "Der Termin am Dienstag ist bestätigt." }))).toBe(true);
  });

  it("liest das Rückkehrdatum aus Abwesenheitsnotizen", () => {
    const at = new Date("2026-11-08T09:00:00Z");
    expect(outOfOfficeUntil("Ich bin bis 10.11. nicht im Büro.", at, "Europe/Berlin")).toBe("2026-11-10T23:59:00+01:00");
    expect(outOfOfficeUntil("Abwesend bis einschließlich 3.7.2027", at, "Europe/Berlin")).toBe("2027-07-03T23:59:00+02:00");
    expect(outOfOfficeUntil("Bis 2.1. im Urlaub", at, "Europe/Berlin")).toBe("2027-01-02T23:59:00+01:00");
    expect(outOfOfficeUntil("Ab 10.11. bin ich im Urlaub.", at, "Europe/Berlin")).toBeUndefined();
  });
});

describe("Signale, Aufgaben und Kontaktdaten (v1.2/v1.3)", () => {
  async function linked(settings: Partial<CrmSettings> = {}) {
    const s = await setup(settings, { secret: "whsec_test_geheimnis_1234567890" });
    crm.seedContact(ERIKA.email, ERIKA.name, [{ title: "Rahmenvertrag 2027" }]);
    const leadId = crm.deals[0]!.id;
    await linkThread(s.user.id, s.thread.id, leadId, "user");
    await runJobs();
    return { ...s, leadId };
  }

  it("Zusage des Kunden: Aktivität am Lead plus Signal offer_accepted mit Vorschlag – Entscheidung kommt per Rückkanal zurück", async () => {
    classifyWith((m) =>
      m.body.includes("nehmen Ihr Angebot an")
        ? { ...EMPTY_ANALYSIS, signals: [{ signal: "offer_accepted", confidence: 0.92, quote: "wir nehmen Ihr Angebot an", summary: "Kunde nimmt das Angebot an.", data: {} }] }
        : EMPTY_ANALYSIS,
    );
    const { account, thread, leadId, integration } = await linked();
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, bodyText: "Guten Tag, wir nehmen Ihr Angebot an." }));
    await runJobs();

    const [, reply] = [...crm.activities.values()];
    expect(reply!.body).toMatchObject({ leadId, direction: "inbound" }); // echte Antwort zählt als Kundenreaktion
    expect(crm.signals).toHaveLength(1);
    const call = crm.requests.find((r) => r.path.endsWith("/signals"))!;
    expect(call.headers["idempotency-key"]).toMatch(/^signal:[0-9a-f-]{36}:offer_accepted$/);
    expect(call.body).toMatchObject({ signal: "offer_accepted", evidence: { quote: "wir nehmen Ihr Angebot an", confidence: 0.92 } });
    expect(String(call.body!.externalId)).toMatch(/^email:/);

    const [row] = await db.select().from(schema.crmSignals).where(eq(schema.crmSignals.integrationId, integration.id));
    expect(row!.proposals.map((p) => p.kind)).toEqual(["deal.mark_won"]);
    expect(row!.sentAt).not.toBeNull();

    // Ein Mensch verwirft den Vorschlag im CRM
    const SECRET = "whsec_test_geheimnis_1234567890";
    const body = JSON.stringify({ id: "evt_pr1", type: "signal.proposal_resolved", occurredAt: new Date().toISOString(), workspaceId: "ws_sandbox", data: { proposalId: row!.proposals[0]!.id, kind: "deal.mark_won", accepted: false, signal: "offer_accepted", externalId: "x", resolvedAt: "2026-11-08T10:20:00.000Z" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await receiveWebhook(body, new Headers({ "x-okun-timestamp": ts, "x-okun-signature": signWebhook(body, ts, SECRET), "x-okun-workspace": "ws_sandbox" }), null);
    expect(res.status).toBe(200);
    const [after] = await db.select().from(schema.crmSignals).where(eq(schema.crmSignals.id, row!.id));
    expect(after!.proposals[0]).toMatchObject({ accepted: false, resolvedAt: "2026-11-08T10:20:00.000Z" });
    expect(thread.id).toBeTruthy();
  });

  it("Angebot verschickt: nur passende ausgehende Mails werden eingeordnet; Phase und nächster Schritt kommen aus der Antwort", async () => {
    classifyWith((m) =>
      m.attachments.includes("Angebot_2026-117.pdf")
        ? { ...EMPTY_ANALYSIS, signals: [{ signal: "offer_sent", confidence: 0.93, quote: "anbei unser Angebot", summary: "Angebot 2026-117 verschickt.", data: { offerNumber: "2026-117", valueCents: 2_400_000 } }] }
        : EMPTY_ANALYSIS,
    );
    const { account, thread } = await linked();
    classified = [];
    const out = { from: { email: account.emailAddress }, to: [ERIKA], isOutgoing: true, providerThreadId: "t1" };
    await deliver(account, message({ ...out, providerMessageId: "m2", bodyText: "Danke für das nette Gespräch!" }));
    await deliver(account, message({ ...out, providerMessageId: "m3", bodyText: "Hallo Frau Muster, anbei unser Angebot.", attachments: [{ providerAttachmentId: "a1", filename: "Angebot_2026-117.pdf", mimeType: "application/pdf", sizeBytes: 1000 }] }));
    await runJobs();

    expect(classified).toHaveLength(1);
    expect(crm.deals[0]).toMatchObject({ stageId: "st_angebot", valueCents: 2_400_000 });
    const [link] = await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, thread.id));
    expect(link).toMatchObject({ leadStage: "Angebot", nextActionTitle: "Angebot nachfassen", operationalState: "waiting_for_customer" });
    expect(link!.nextActionDueAt).not.toBeNull();
    const [row] = await db.select().from(schema.crmSignals);
    expect(row!.applied).toEqual(expect.arrayContaining(["stage_changed:Angebot", "value_updated", "offer_follow_up"]));
  });

  it("Rückruf-Bitte wird Aufgabe (dauerhaft idempotent), Signatur ergänzt leere Kontaktfelder", async () => {
    classifyWith((m) =>
      m.body.includes("rufen Sie mich")
        ? {
            signals: [],
            task: { title: "Frau Muster zurückrufen", dueAt: "2026-11-10T10:00:00+01:00", confidence: 0.9, quote: "Bitte rufen Sie mich am Dienstag an." },
            contactDetails: { fields: { phone: "+49 40 123456", jobTitle: "Einkaufsleiterin" }, confidence: 0.9, quote: "Tel. +49 40 123456" },
          }
        : EMPTY_ANALYSIS,
    );
    const { account, leadId } = await linked();
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, bodyText: "Bitte rufen Sie mich am Dienstag an.\n\nErika Muster\nEinkaufsleiterin\nTel. +49 40 123456" }));
    await runJobs();

    const tasks = [...crm.tasks.entries()];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]![0]).toMatch(/^task:[0-9a-f-]{36}$/);
    expect(tasks[0]![1].body).toMatchObject({ title: "Frau Muster zurückrufen", dueAt: "2026-11-10T10:00:00+01:00", leadId });
    expect(crm.contacts[0]).toMatchObject({ phone: "+49 40 123456", jobTitle: "Einkaufsleiterin" });
    const [contactRow] = await db.select().from(schema.crmSignals).where(eq(schema.crmSignals.signal, "contact_details"));
    expect(contactRow!.applied).toEqual(["filled:phone", "filled:jobTitle"]);

    // Erneutes Senden derselben Aufgabe (z. B. nach einem Abbruch) legt keine zweite an
    await db.update(schema.crmSignals).set({ sentAt: null }).where(eq(schema.crmSignals.signal, "task"));
    await deliver(account, message({ providerMessageId: "m9", providerThreadId: "t1", from: { email: account.emailAddress }, to: [ERIKA], isOutgoing: true, bodyText: "Danke!" }));
    await runJobs();
    expect(crm.tasks.size).toBe(1);
    const [taskRow] = await db.select().from(schema.crmSignals).where(eq(schema.crmSignals.signal, "task"));
    expect(taskRow!.applied).toEqual(["task_exists"]);
  });

  it("CRM-Ausfall: Wiederholung sendet ohne erneute Einordnung; 422 wird festgehalten statt wiederholt", async () => {
    classifyWith((m) =>
      m.body.includes("Termin")
        ? { ...EMPTY_ANALYSIS, signals: [{ signal: "meeting_requested", confidence: 0.85, quote: "gern einen Termin", summary: "Terminwunsch.", data: {} }] }
        : EMPTY_ANALYSIS,
    );
    const { account, thread, integration } = await linked();
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, bodyText: "Wir hätten gern einen Termin." }));
    const [link] = await db.select().from(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.threadId, thread.id));
    await logThreadMessages(integration, link!);
    classified = [];
    await analyzeThreadSignals(integration, link!);
    expect(classified).toHaveLength(1);

    crm.failNext = 1;
    await expect(sendPendingSignals(integration, thread.id)).rejects.toMatchObject({ status: 503, retryable: true });
    expect(await sendPendingSignals(integration, thread.id)).toBe(1);
    await analyzeThreadSignals(integration, link!);
    expect(classified).toHaveLength(1); // nicht erneut eingeordnet
    expect(crm.signals).toHaveLength(1);

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.providerMessageId, "m2"));
    await db.insert(schema.crmSignals).values({ integrationId: integration.id, emailId: email!.id, threadId: thread.id, leadId: link!.leadId!, signal: "question", payload: { signal: "unbekannt", occurredAt: new Date().toISOString(), externalId: "email:x", url: "https://okun-mailwin.com/emails/x" } });
    expect(await sendPendingSignals(integration, thread.id)).toBe(0);
    const [failed] = await db.select().from(schema.crmSignals).where(eq(schema.crmSignals.signal, "question"));
    expect(failed!.error).toMatch(/^validation_failed/);
    expect(await sendPendingSignals(integration, thread.id)).toBe(0); // kein erneuter Versuch
  });

  it("Signale nur, wenn Marvin verfügbar ist – Abwesenheitsnotizen trotzdem", async () => {
    setAiConfigured(false);
    const { account } = await linked();
    await deliver(account, message({ providerMessageId: "m2", providerThreadId: "t1", from: ERIKA, subject: "Out of Office: Anfrage", bodyText: "Back on 12.11." }));
    await deliver(account, message({ providerMessageId: "m3", providerThreadId: "t1", from: ERIKA, bodyText: "Wir nehmen Ihr Angebot an." }));
    await runJobs();
    expect(classified).toHaveLength(0);
    expect(crm.signals.map((x) => x.body.signal)).toEqual(["out_of_office"]);
  });
});

describe("Ablauf D – Webhooks des CRM", () => {
  const SECRET = "whsec_test_geheimnis_1234567890";

  function delivery(event: Record<string, unknown>, opts: { secret?: string; ts?: number; workspace?: string } = {}) {
    const raw = JSON.stringify(event);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const headers = new Headers({
      "x-okun-timestamp": ts,
      "x-okun-signature": signWebhook(raw, ts, opts.secret ?? SECRET),
      "x-okun-event": String(event.type),
      ...(opts.workspace ? { "x-okun-workspace": opts.workspace } : {}),
    });
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

  it("v1.3: wählt die Integration über den Arbeitsbereich vor – entscheidend bleibt die Signatur", async () => {
    const { leadId } = await linkedSetup();
    const event = { ...leadEvent("lead.stage_changed", leadId, { id: "st_angebot", name: "Angebot" }, "open", new Date().toISOString()), workspaceId: "ws_sandbox" };
    const ok = delivery(event, { workspace: "ws_sandbox" });
    expect((await receiveWebhook(ok.raw, ok.headers, null)).status).toBe(200);
    expect((await db.select().from(schema.crmThreadLinks))[0]!.leadStage).toBe("Angebot");
    // Ein falscher Arbeitsbereich im Header hilft einer gefälschten Signatur nicht
    const forged = delivery({ ...event, id: "evt_x" }, { workspace: "ws_sandbox", secret: "falsches_geheimnis_123456" });
    expect((await receiveWebhook(forged.raw, forged.headers, null)).status).toBe(401);
  });

  it("v1.3: lead.deleted stuft auf den Kontakt zurück und verwirft offene Meldungen; contact.merged zieht die Kontakt-ID nach", async () => {
    const { user, thread, leadId, integration } = await linkedSetup();
    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.threadId, thread.id));
    await db.insert(schema.crmSignals).values({ integrationId: integration.id, emailId: email!.id, threadId: thread.id, leadId, signal: "question", payload: {} });

    const del = delivery({ id: "evt_del", type: "lead.deleted", occurredAt: new Date().toISOString(), workspaceId: "ws_sandbox", data: { id: leadId } });
    expect((await receiveWebhook(del.raw, del.headers, null)).status).toBe(200);
    const [link] = await db.select().from(schema.crmThreadLinks);
    expect(link).toMatchObject({ leadId: null, leadTitle: null, contactName: "Erika Muster" });
    expect((await db.select().from(schema.crmSignals))[0]!.error).toMatch(/gelöscht/);
    const notes = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.kind, "crm_update")));
    expect(notes.map((n) => n.title)).toEqual(["Lead im CRM gelöscht: Rahmenvertrag 2027"]);

    const merged = delivery({
      id: "evt_merge",
      type: "contact.merged",
      occurredAt: new Date().toISOString(),
      workspaceId: "ws_sandbox",
      data: { fromId: link!.contactId, intoId: "ct_neu", contact: { id: "ct_neu", name: "Erika Muster-Schmidt", email: ERIKA.email, url: "https://crm/contacts/ct_neu" } },
    });
    expect((await receiveWebhook(merged.raw, merged.headers, null)).status).toBe(200);
    expect((await db.select().from(schema.crmThreadLinks))[0]).toMatchObject({ contactId: "ct_neu", contactName: "Erika Muster-Schmidt" });
  });

  it("v1.3: nächster Schritt wird angezeigt; fällig → Marvin bereitet einen Nachfass-Entwurf zur Freigabe vor", async () => {
    const { user, thread, leadId } = await linkedSetup();
    const lead = { id: leadId, title: "Rahmenvertrag 2027", url: `${crm.appUrl}/deals/${leadId}`, stage: { id: "st_angebot", name: "Angebot" }, status: "open", contacts: [], sourceRef: null };
    const changed = delivery({ id: "evt_na", type: "lead.next_action_changed", occurredAt: new Date().toISOString(), workspaceId: "ws_sandbox", data: { lead, nextAction: { type: "chase_offer", title: "Angebot nachfassen", reason: "Seit 7 Tagen keine Antwort", dueAt: "2026-11-10T09:12:00.000Z", operationalState: "waiting_for_customer" } } });
    expect((await receiveWebhook(changed.raw, changed.headers, null)).status).toBe(200);
    expect((await db.select().from(schema.crmThreadLinks))[0]).toMatchObject({ nextActionTitle: "Angebot nachfassen", operationalState: "waiting_for_customer", leadStage: "Angebot" });

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.threadId, thread.id));
    const calls: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
    const replies: Partial<Anthropic.Beta.Messages.BetaMessage>[] = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "draft_email", input: { to: [{ email: ERIKA.email }], subject: "Re: Anfrage Wartungsvertrag", body: "Guten Tag Frau Muster, darf ich kurz nachfragen …", reply_to_email_id: email!.id } } as never] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Der Entwurf liegt zur Freigabe bereit.", citations: null } as never] },
    ];
    setModelCaller(async (params) => {
      calls.push(structuredClone(params));
      return { id: `msg_${calls.length}`, type: "message", role: "assistant", model: params.model, ...replies[calls.length - 1] } as Anthropic.Beta.Messages.BetaMessage;
    });
    const due = delivery({ id: "evt_due", type: "lead.next_action_due", occurredAt: new Date().toISOString(), workspaceId: "ws_sandbox", data: { lead, nextAction: { id: "na_1", type: "chase_offer", title: "Angebot nachfassen", reason: "Seit 7 Tagen keine Antwort", dueAt: "2026-11-10T09:12:00.000Z" } } });
    expect((await receiveWebhook(due.raw, due.headers, null)).status).toBe(200); // antwortet sofort, Entwurf im Hintergrund
    await runJobs();

    expect(calls).toHaveLength(2);
    const prompt = JSON.stringify(calls[0]!.messages);
    expect(prompt).toContain("[Systemhinweis von Mailwin]");
    expect(prompt).toContain("Angebot nachfassen");
    expect(calls[0]!.tools!.map((t) => (t as { name?: string }).name)).toContain("crm_lookup");
    const [approval] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.userId, user.id));
    expect(approval).toMatchObject({ action: "send_email", status: "pending" });
    expect(provider.sent).toHaveLength(0); // nie automatisch versendet
    const notes = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.kind, "crm_update")));
    expect(notes.map((n) => n.title)).toContain("Nachfassen fällig: Rahmenvertrag 2027");
    const [conversation] = await db.select().from(schema.marvinConversations).where(eq(schema.marvinConversations.userId, user.id));
    expect(conversation!.title).toBe("CRM: Angebot nachfassen – Rahmenvertrag 2027");
  });

  it("v1.3: ohne Marvin wird der fällige Schritt zur Aufgabe an der Konversation", async () => {
    setAiConfigured(false);
    const { user, thread, leadId } = await linkedSetup();
    const lead = { id: leadId, title: "Rahmenvertrag 2027", stage: { id: "st_qual", name: "Qualifiziert" }, status: "open", contacts: [], sourceRef: null };
    const due = delivery({ id: "evt_due2", type: "lead.next_action_due", occurredAt: new Date().toISOString(), workspaceId: "ws_sandbox", data: { lead, nextAction: { id: "na_2", type: "follow_up", title: "Nachfassen", dueAt: null } } });
    await receiveWebhook(due.raw, due.headers, null);
    await runJobs();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.userId, user.id));
    expect(task).toMatchObject({ title: "Nachfassen: Rahmenvertrag 2027", threadId: thread.id });
  });
});
