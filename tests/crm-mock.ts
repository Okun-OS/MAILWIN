import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Nachbau der „Mailwin Connect API“ v1 des OKUN CRM nach UEBERGABE-MAILWIN.md / openapi.json
 * (Okun-OS/CRM, docs/mailwin). Bildet Statuscodes, Fehlerhülle, Idempotenz und Validierung nach.
 */
export const MOCK_KEY = "okun_mw_testschluessel";

type Contact = { id: string; name: string; email: string; phone: string | null; companyId: string | null; jobTitle?: string | null };
type Deal = {
  id: string;
  title: string;
  description: string;
  pipelineId: string;
  stageId: string;
  status: "open" | "won" | "lost";
  contactId: string;
  valueCents?: number;
  sourceRef: Record<string, string>;
  nextAction?: { type: string; title: string; dueAt: string | null } | null;
  pausedUntil?: string | null;
};

export interface MockRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> | null;
}

const PIPELINE = {
  id: "pl_vertrieb",
  name: "Vertrieb",
  isDefault: true,
  stages: [
    { id: "st_lead", name: "Lead", order: 0, type: "open" },
    { id: "st_qual", name: "Qualifiziert", order: 1, type: "open" },
    { id: "st_angebot", name: "Angebot", order: 2, type: "open" },
    { id: "st_won", name: "Gewonnen", order: 3, type: "won" },
    { id: "st_lost", name: "Verloren", order: 4, type: "lost" },
  ],
};

const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const httpUrl = (v: unknown) => typeof v === "string" && /^https?:\/\//.test(v);

export class MockCrm {
  server: http.Server;
  baseUrl = "";
  appUrl = "";
  requests: MockRequest[] = [];
  revoked = false;
  rateLimitNext = 0;
  /** Nächste n Anfragen mit 503 beantworten (Wiederholung testen) */
  failNext = 0;
  signals: { leadId: string; body: Record<string, unknown>; outcome: Record<string, unknown> }[] = [];
  tasks = new Map<string, { id: string; body: Record<string, unknown> }>();
  suggestions: { contactId: string; body: Record<string, unknown> }[] = [];
  contacts: Contact[] = [];
  companies: { id: string; name: string; domain: string | null }[] = [];
  deals: Deal[] = [];
  activities = new Map<string, { id: string; body: Record<string, unknown> }>();
  private idem = new Map<string, { hash: string; status: number; body: unknown }>();
  private seq = 0;

  constructor() {
    this.server = http.createServer((req, res) => void this.handle(req, res));
  }

  async start() {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const { port } = this.server.address() as AddressInfo;
    this.appUrl = `http://127.0.0.1:${port}`;
    this.baseUrl = `${this.appUrl}/api/mailwin/v1`;
    return this;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  reset() {
    Object.assign(this, { requests: [], revoked: false, rateLimitNext: 0, failNext: 0, contacts: [], companies: [], deals: [], signals: [], suggestions: [] });
    this.activities.clear();
    this.tasks.clear();
    this.idem.clear();
  }

  id(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  /** Testdaten wie im Sandbox-Arbeitsbereich: Erika Muster mit offenem Lead „Rahmenvertrag 2027“. */
  seedContact(email: string, name: string, leads: { title: string; stageId?: string }[] = [], company?: string) {
    const companyId = company ? this.id("co") : null;
    if (company) this.companies.push({ id: companyId!, name: company, domain: email.split("@")[1]! });
    const contact = { id: this.id("ct"), name, email, phone: null, companyId };
    this.contacts.push(contact);
    for (const l of leads) {
      this.deals.push({ id: this.id("dl"), title: l.title, description: "", pipelineId: PIPELINE.id, stageId: l.stageId ?? "st_qual", status: "open", contactId: contact.id, sourceRef: {} });
    }
    return contact;
  }

  view(c: Contact) {
    const company = this.companies.find((x) => x.id === c.companyId) ?? null;
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company,
      openLeads: this.deals
        .filter((d) => d.contactId === c.id && d.status === "open")
        .map((d) => ({ id: d.id, title: d.title, stage: PIPELINE.stages.find((s) => s.id === d.stageId)!.name, stageId: d.stageId, pipelineId: d.pipelineId, url: `${this.appUrl}/deals/${d.id}` })),
      url: `${this.appUrl}/contacts/${c.id}`,
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/^\/api\/mailwin\/v1/, "");
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return send(res, 400, err("invalid_request", "Ungültiges JSON."));
    }
    this.requests.push({ method: req.method ?? "GET", path: path + url.search, headers: req.headers, body });

    if (req.headers.authorization !== `Bearer ${MOCK_KEY}` || this.revoked) {
      return send(res, 401, err("unauthorized", "Der API-Schlüssel fehlt, ist ungültig oder wurde widerrufen."));
    }
    if (this.failNext > 0) {
      this.failNext--;
      return send(res, 503, err("internal_error", "Vorübergehend nicht verfügbar."));
    }
    if (this.rateLimitNext > 0) {
      this.rateLimitNext--;
      return send(res, 429, err("rate_limited", "Zu viele Anfragen: höchstens 120 pro Minute und Schlüssel."), { "Retry-After": "7" });
    }

    // Idempotenz: nur 2xx wird gespeichert; gleicher Schlüssel mit anderem Body → 422
    const key = req.method === "POST" ? (req.headers["idempotency-key"] as string | undefined) : undefined;
    const hash = createHash("sha256").update(`${path}:${raw}`).digest("hex");
    if (key) {
      const prev = this.idem.get(key);
      if (prev && prev.hash !== hash) return send(res, 422, err("idempotency_key_reused", "Der Idempotency-Key wurde mit anderen Daten verwendet."));
      if (prev) return send(res, prev.status, prev.body, { "Idempotent-Replayed": "true" });
    }
    const [status, out] = this.route(req.method ?? "GET", path, url.searchParams, body ?? {});
    if (key && status < 300) this.idem.set(key, { hash, status, body: out });
    send(res, status, out);
  }

  private route(method: string, path: string, q: URLSearchParams, b: Record<string, unknown>): [number, unknown] {
    if (method === "GET" && path === "/me") return [200, { workspaceId: "ws_sandbox", name: "Mailwin Sandbox", appUrl: this.appUrl }];
    if (method === "GET" && path === "/pipelines") return [200, [PIPELINE]];
    if (method === "GET" && path === "/contacts") {
      const email = (q.get("email") ?? "").toLowerCase();
      if (!email) return [400, err("invalid_request", "Parameter email fehlt.")];
      return [200, this.contacts.filter((c) => c.email.toLowerCase() === email).map((c) => this.view(c))];
    }
    if (method === "POST" && path === "/contacts") {
      if (typeof b.email !== "string") return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", { email: "Pflichtfeld" })];
      const existing = this.contacts.find((c) => c.email.toLowerCase() === (b.email as string).toLowerCase());
      if (existing) {
        existing.phone ??= (b.phone as string) ?? null;
        return [200, this.view(existing)];
      }
      const c = { id: this.id("ct"), name: (b.name as string) ?? `Unbekannt ${b.email}`, email: b.email as string, phone: (b.phone as string) ?? null, companyId: null };
      this.contacts.push(c);
      return [201, this.view(c)];
    }
    if (method === "POST" && path === "/leads") {
      const fields: Record<string, string> = {};
      const contact = b.contact as { email?: string; name?: string } | undefined;
      const ref = b.sourceRef as Record<string, unknown> | undefined;
      if (!contact?.email) fields["contact.email"] = "Pflichtfeld";
      if (typeof b.title !== "string" || !b.title.length || b.title.length > 160) fields.title = "1–160 Zeichen";
      if (typeof b.description !== "string" || b.description.length > 10_000) fields.description = "Pflichtfeld, höchstens 10 000 Zeichen";
      if (b.source !== "mailwin") fields.source = "muss „mailwin“ sein";
      for (const k of ["channel", "threadId", "messageId", "url"]) if (!ref?.[k]) fields[`sourceRef.${k}`] = "Pflichtfeld";
      if (ref?.url && !httpUrl(ref.url)) fields["sourceRef.url"] = "http(s)-Adresse erforderlich";
      if (b.valueCents !== undefined && !Number.isInteger(b.valueCents)) fields.valueCents = "ganze Zahl";
      const stage = b.stageId ? PIPELINE.stages.find((s) => s.id === b.stageId) : PIPELINE.stages[0];
      if (!stage || (b.pipelineId && b.pipelineId !== PIPELINE.id)) fields.stageId = "Unbekannte Phase";
      if (Object.keys(fields).length) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", fields)];
      let c = this.contacts.find((x) => x.email.toLowerCase() === contact!.email!.toLowerCase());
      if (!c) {
        c = { id: this.id("ct"), name: contact!.name ?? `Unbekannt ${contact!.email}`, email: contact!.email!, phone: null, companyId: null };
        this.contacts.push(c);
      }
      if (b.companyName && !c.companyId) {
        const co = { id: this.id("co"), name: b.companyName as string, domain: null };
        this.companies.push(co);
        c.companyId = co.id;
      }
      const deal: Deal = { id: this.id("dl"), title: b.title as string, description: b.description as string, pipelineId: PIPELINE.id, stageId: stage!.id, status: "open", contactId: c.id, valueCents: b.valueCents as number | undefined, sourceRef: ref as Record<string, string> };
      this.deals.push(deal);
      return [201, { id: deal.id, url: `${this.appUrl}/deals/${deal.id}` }];
    }
    if (method === "POST" && path === "/activities") {
      const fields: Record<string, string> = {};
      if (!["email", "whatsapp", "note"].includes(b.type as string)) fields.type = "ungültig";
      if (!["inbound", "outbound"].includes(b.direction as string)) fields.direction = "ungültig";
      if (typeof b.summary !== "string" || !b.summary.length || b.summary.length > 10_000) fields.summary = "1–10 000 Zeichen";
      if (typeof b.subject === "string" && b.subject.length > 200) fields.subject = "höchstens 200 Zeichen";
      if (typeof b.occurredAt !== "string" || !ZONED.test(b.occurredAt)) fields.occurredAt = "Bitte einen Zeitpunkt nach ISO 8601 mit Zeitzone angeben.";
      if (typeof b.externalId !== "string" || !b.externalId || b.externalId.length > 200) fields.externalId = "1–200 Zeichen";
      if (!httpUrl(b.url)) fields.url = "http(s)-Adresse erforderlich";
      if (!b.contactId && !b.leadId) fields.contactId = "contactId oder leadId angeben";
      if (Object.keys(fields).length) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", fields)];
      if (b.contactId && !this.contacts.some((c) => c.id === b.contactId)) return [404, err("not_found", "Kontakt nicht gefunden.")];
      if (b.leadId && !this.deals.some((d) => d.id === b.leadId)) return [404, err("not_found", "Lead nicht gefunden.")];
      const existing = this.activities.get(b.externalId as string);
      if (existing) return [200, { id: existing.id }];
      const id = this.id("ac");
      this.activities.set(b.externalId as string, { id, body: b });
      return [201, { id }];
    }
    const leadPath = /^\/leads\/([^/]+)(\/signals)?$/.exec(path);
    if (leadPath) {
      const deal = this.deals.find((d) => d.id === decodeURIComponent(leadPath[1]!));
      if (!deal) return [404, err("not_found", "Lead nicht gefunden.")];
      if (method === "GET" && !leadPath[2]) return [200, this.leadContext(deal)];
      if (method === "POST" && leadPath[2]) return this.signal(deal, b);
    }
    if (method === "POST" && path === "/tasks") {
      const fields: Record<string, string> = {};
      if (typeof b.title !== "string" || !b.title || b.title.length > 200) fields.title = "1–200 Zeichen";
      if (b.dueAt !== undefined && (typeof b.dueAt !== "string" || !ZONED.test(b.dueAt))) fields.dueAt = "ISO 8601 mit Zeitzone";
      if (typeof b.externalId === "string" && b.externalId.length > 200) fields.externalId = "höchstens 200 Zeichen";
      if (Object.keys(fields).length) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", fields)];
      if (b.leadId && !this.deals.some((d) => d.id === b.leadId)) return [404, err("not_found", "Lead nicht gefunden.")];
      const existing = typeof b.externalId === "string" ? this.tasks.get(b.externalId) : undefined;
      if (existing) return [200, { id: existing.id, url: `${this.appUrl}/tasks/${existing.id}`, duplicate: true }];
      const id = this.id("tk");
      this.tasks.set(String(b.externalId ?? id), { id, body: b });
      return [201, { id, url: `${this.appUrl}/tasks/${id}`, duplicate: false }];
    }
    const sugg = /^\/contacts\/([^/]+)\/suggestions$/.exec(path);
    if (method === "POST" && sugg) {
      const contact = this.contacts.find((c) => c.id === decodeURIComponent(sugg[1]!));
      if (!contact) return [404, err("not_found", "Kontakt nicht gefunden.")];
      const fields = (b.fields ?? {}) as Record<string, string>;
      const quote = (b.evidence as { quote?: string } | undefined)?.quote;
      if (!Object.keys(fields).length) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", { fields: "mindestens ein Feld" })];
      if (quote && quote.length > 300) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", { "evidence.quote": "höchstens 300 Zeichen" })];
      this.suggestions.push({ contactId: contact.id, body: b });
      const applied: string[] = [];
      const proposed: string[] = [];
      // Leere Felder füllen, abweichende vorschlagen – nie überschreiben
      for (const key of ["phone", "jobTitle"] as const) {
        const value = fields[key];
        if (!value) continue;
        if (!contact[key]) {
          contact[key] = value;
          applied.push(key);
        } else if (contact[key] !== value) proposed.push(key);
      }
      return [200, { applied, proposed: proposed.length ? { id: this.id("sg"), fields: proposed } : null, contact: this.view(contact) }];
    }
    return [404, err("not_found", "Unbekannter Pfad.")];
  }

  stageOf(deal: Deal) {
    return PIPELINE.stages.find((s) => s.id === deal.stageId)!;
  }

  leadContext(deal: Deal) {
    const contact = this.contacts.find((c) => c.id === deal.contactId)!;
    return {
      id: deal.id,
      title: deal.title,
      url: `${this.appUrl}/deals/${deal.id}`,
      status: deal.status,
      stage: { id: deal.stageId, name: this.stageOf(deal).name },
      valueCents: deal.valueCents ?? 0,
      currency: "EUR",
      owner: { name: "Olga Okun", email: "olga@okun.test" },
      contacts: [{ id: contact.id, name: contact.name, email: contact.email, isPrimary: true }],
      operationalState: "waiting_for_us",
      nextAction: deal.nextAction ?? null,
      automationPausedUntil: deal.pausedUntil ?? null,
      openTasks: [...this.tasks.values()].filter((t) => t.body.leadId === deal.id).map((t) => ({ id: t.id, title: t.body.title, dueAt: t.body.dueAt ?? null })),
      recentActivities: [...this.activities.values()].filter((a) => a.body.leadId === deal.id).slice(-5).reverse().map((a) => ({ id: a.id, type: a.body.type, direction: a.body.direction, subject: a.body.subject ?? null })),
      pendingSuggestions: [],
    };
  }

  /** Signale nach ZUSATZ-ABLAEUFE.md §3: Phasen nur vorwärts, Gewonnen/Verloren nur als Vorschlag. */
  signal(deal: Deal, b: Record<string, unknown>): [number, unknown] {
    const fields: Record<string, string> = {};
    const allowed = ["offer_sent", "offer_accepted", "offer_declined", "meeting_requested", "meeting_booked", "question", "out_of_office", "contract_sent", "contract_accepted"];
    if (!allowed.includes(b.signal as string)) fields.signal = "unbekanntes Signal";
    if (typeof b.occurredAt !== "string" || !ZONED.test(b.occurredAt)) fields.occurredAt = "ISO 8601 mit Zeitzone";
    if (typeof b.externalId !== "string" || !b.externalId) fields.externalId = "Pflichtfeld";
    const ev = b.evidence as { quote?: string; confidence?: number } | undefined;
    if (ev?.quote && ev.quote.length > 300) fields["evidence.quote"] = "höchstens 300 Zeichen";
    if (Object.keys(fields).length) return [422, err("validation_failed", "Die übermittelten Daten sind ungültig.", fields)];
    const dup = this.signals.find((x) => x.leadId === deal.id && x.body.signal === b.signal && x.body.externalId === b.externalId);
    if (dup) return [200, { ...dup.outcome, duplicate: true }];
    const applied = ["timeline"];
    const proposed: { id: string; kind: string; title: string }[] = [];
    const ignored: string[] = [];
    const forward = (stageId: string) => {
      const target = PIPELINE.stages.find((s) => s.id === stageId)!;
      if (deal.status !== "open") ignored.push("lead_closed: nur protokolliert");
      else if (target.order > this.stageOf(deal).order) {
        deal.stageId = stageId;
        applied.push(`stage_changed:${target.name}`);
      } else ignored.push("stage: nur vorwärts");
    };
    const data = (b.data ?? {}) as Record<string, unknown>;
    switch (b.signal) {
      case "offer_sent":
        forward("st_angebot");
        if (typeof data.valueCents === "number") {
          if (!deal.valueCents) {
            deal.valueCents = data.valueCents;
            applied.push("value_updated");
          } else if (deal.valueCents !== data.valueCents) proposed.push({ id: this.id("pr"), kind: "deal.update_value", title: "Wert aktualisieren?" });
        }
        deal.nextAction = { type: "chase_offer", title: "Angebot nachfassen", dueAt: new Date(Date.parse(String(b.occurredAt)) + 7 * 86_400_000).toISOString() };
        applied.push("offer_follow_up");
        break;
      case "offer_accepted":
      case "contract_accepted":
        proposed.push({ id: this.id("pr"), kind: "deal.mark_won", title: "Als gewonnen markieren?" });
        if (!ev?.quote) ignored.push("won: ohne wörtliches Zitat — deshalb nur ein Vorschlag.");
        break;
      case "offer_declined":
        proposed.push({ id: this.id("pr"), kind: "deal.mark_lost", title: "Als verloren markieren?" });
        break;
      case "out_of_office":
        deal.pausedUntil = (data.until as string) ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
        applied.push("automation_paused");
        break;
      default:
        deal.nextAction = { type: b.signal === "meeting_requested" ? "schedule_meeting" : "follow_up", title: b.signal === "question" ? "Rückfrage beantworten" : "Termin vereinbaren", dueAt: null };
        applied.push("next_action_set");
    }
    const outcome = {
      signal: b.signal,
      duplicate: false,
      applied,
      proposed,
      ignored,
      lead: { id: deal.id, url: `${this.appUrl}/deals/${deal.id}`, status: deal.status, stage: { id: deal.stageId, name: this.stageOf(deal).name }, valueCents: deal.valueCents ?? 0, nextAction: deal.nextAction ?? null, operationalState: "waiting_for_customer" },
    };
    this.signals.push({ leadId: deal.id, body: b, outcome });
    return [201, outcome];
  }
}

function err(code: string, message: string, fields?: Record<string, string>) {
  return { error: { code, message, ...(fields ? { details: { fields } } : {}) } };
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}
