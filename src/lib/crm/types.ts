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
