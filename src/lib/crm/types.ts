/**
 * Gemeinsame Schnittstelle für CRM-Systeme (OKUN CRM zuerst, später HubSpot, Pipedrive …).
 * Begriffe aus Mailwin-Sicht: „Lead“ = Verkaufschance (im OKUN CRM: Deal).
 */
export interface CrmCompanyRef {
  id: string;
  name: string;
  domain: string | null;
}

export interface CrmOpenLead {
  id: string;
  title: string;
  stage: string;
  stageId?: string;
  pipelineId?: string;
  url: string;
}

export interface CrmContact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: CrmCompanyRef | null;
  openLeads: CrmOpenLead[];
  url: string;
}

export interface CrmPipeline {
  id: string;
  name: string;
  isDefault?: boolean;
  stages: { id: string; name: string; order: number; type?: "open" | "won" | "lost" }[];
}

export interface CrmSourceRef {
  channel: "email" | "whatsapp";
  threadId: string;
  messageId: string;
  url: string;
}

export interface CrmLeadInput {
  contact: { email: string; name?: string };
  companyName?: string;
  title: string;
  description: string;
  pipelineId?: string;
  stageId?: string;
  valueCents?: number;
  sourceRef: CrmSourceRef;
}

export interface CrmActivityInput {
  contactId?: string;
  leadId?: string;
  type: "email" | "whatsapp" | "note";
  direction: "inbound" | "outbound";
  subject?: string;
  summary: string;
  occurredAt: Date;
  externalId: string;
  url: string;
}

export const SIGNALS = ["offer_sent", "offer_accepted", "offer_declined", "meeting_requested", "meeting_booked", "question", "out_of_office", "contract_sent", "contract_accepted"] as const;
export type CrmSignalName = (typeof SIGNALS)[number];

export interface CrmEvidence {
  /** wörtlich aus der Nachricht, höchstens 300 Zeichen */
  quote?: string;
  confidence?: number;
}

export interface CrmSignalInput {
  signal: CrmSignalName;
  occurredAt: Date;
  externalId: string;
  url: string;
  summary?: string;
  evidence?: CrmEvidence;
  data?: { valueCents?: number; offerNumber?: string; validUntil?: string; startAt?: string; endAt?: string; title?: string; location?: string; until?: string; reason?: string };
}

export interface CrmNextAction {
  type: string;
  title: string;
  dueAt: string | null;
}

export interface CrmSignalOutcome {
  signal: string;
  duplicate: boolean;
  applied: string[];
  proposed: { id: string; kind: string; title: string }[];
  ignored: string[];
  lead: { id: string; url?: string; status?: string; stage?: { id: string; name: string }; valueCents?: number; nextAction?: CrmNextAction | null; operationalState?: string };
}

/** GET /leads/{id} – Kontext für Antwortentwürfe */
export interface CrmLeadContext {
  id: string;
  title: string;
  url: string;
  status: "open" | "won" | "lost";
  description?: string | null;
  stage?: { id: string; name: string };
  valueCents?: number;
  currency?: string;
  owner?: { name?: string; email?: string } | null;
  company?: CrmCompanyRef | null;
  contacts?: { id: string; name: string; email: string | null; isPrimary?: boolean }[];
  operationalState?: string;
  nextAction?: CrmNextAction | null;
  offerSentAt?: string | null;
  lastCustomerResponseAt?: string | null;
  nextMeetingAt?: string | null;
  automationPausedUntil?: string | null;
  openTasks?: { id: string; title: string; dueAt: string | null; priority?: string }[];
  recentActivities?: { id: string; type: string; direction: string | null; subject: string | null; summary?: string | null; occurredAt?: string }[];
  pendingSuggestions?: { id: string; kind: string; title: string }[];
}

export interface CrmTaskInput {
  title: string;
  description?: string;
  dueAt?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  contactId?: string;
  leadId?: string;
  url?: string;
  externalId: string;
}

export interface CrmContactSuggestionInput {
  fields: { name?: string; phone?: string; mobile?: string; jobTitle?: string; street?: string; postalCode?: string; city?: string; country?: string };
  evidence?: CrmEvidence;
  url?: string;
  externalId?: string;
}

export interface CrmWorkspace {
  workspaceId: string;
  name: string;
  appUrl: string;
}

export interface CrmConnector {
  me(): Promise<CrmWorkspace>;
  findContacts(email: string): Promise<CrmContact[]>;
  upsertContact(input: { email: string; name?: string; phone?: string; companyName?: string; companyDomain?: string }, idempotencyKey?: string): Promise<CrmContact>;
  pipelines(): Promise<CrmPipeline[]>;
  createLead(input: CrmLeadInput, idempotencyKey: string): Promise<{ id: string; url: string }>;
  logActivity(input: CrmActivityInput, idempotencyKey?: string): Promise<{ id: string }>;
  // v1.2/v1.3
  getLead(id: string): Promise<CrmLeadContext>;
  sendSignal(leadId: string, input: CrmSignalInput, idempotencyKey: string): Promise<CrmSignalOutcome>;
  createTask(input: CrmTaskInput): Promise<{ id: string; url: string; duplicate: boolean }>;
  suggestContactDetails(contactId: string, input: CrmContactSuggestionInput, idempotencyKey?: string): Promise<{ applied: string[]; proposed: { id: string; fields: string[] } | null }>;
}

/** Fehler vom CRM. `code` ist maschinenlesbar (z. B. unauthorized, validation_failed, rate_limited). */
export class CrmError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "CrmError";
  }

  /** Lohnt ein späterer neuer Versuch? (Netz, 429, 409 in Bearbeitung, 5xx) */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status === 409 || this.status >= 500;
  }
}
