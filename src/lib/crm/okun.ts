import { CrmError, type CrmActivityInput, type CrmConnector, type CrmContact, type CrmLeadInput, type CrmPipeline, type CrmWorkspace } from "./types";

const TIMEOUT_MS = 15_000;

/** Nimmt die Basis-URL so, wie der Kunde sie einträgt – mit oder ohne /api/mailwin/v1. */
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Die Basis-URL muss mit https:// beginnen.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/mailwin/v1") ? path : `${path}/api/mailwin/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/**
 * OKUN CRM – „Mailwin Connect API“ v1 (siehe docs/mailwin/UEBERGABE-MAILWIN.md im CRM-Repository).
 * Antworten ohne Hülle, Fehler als { error: { code, message, details } }.
 */
export class OkunCrmClient implements CrmConnector {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 255) } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new CrmError(0, "network", `Das CRM ist nicht erreichbar (${(err as Error).message}).`);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // z. B. HTML-Fehlerseite eines Proxys oder falsche Adresse
      if (res.ok) throw new CrmError(res.status, "invalid_response", "Das CRM hat keine gültige Antwort geliefert.");
    }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: { fields?: Record<string, string> } } } | undefined)?.error;
      const retryHeader = res.headers.get("Retry-After");
      const retry = retryHeader ? Number(retryHeader) : NaN;
      throw new CrmError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `CRM-Fehler ${res.status}`, Number.isFinite(retry) ? retry : undefined, e?.details?.fields);
    }
    return data as T;
  }

  me() {
    return this.call<CrmWorkspace>("GET", "/me");
  }

  findContacts(email: string) {
    return this.call<CrmContact[]>("GET", `/contacts?email=${encodeURIComponent(email)}`);
  }

  upsertContact(input: { email: string; name?: string; phone?: string; companyName?: string; companyDomain?: string }, idempotencyKey?: string) {
    return this.call<CrmContact>("POST", "/contacts", input, idempotencyKey);
  }

  pipelines() {
    return this.call<CrmPipeline[]>("GET", "/pipelines");
  }

  createLead(input: CrmLeadInput, idempotencyKey: string) {
    return this.call<{ id: string; url: string }>(
      "POST",
      "/leads",
      {
        ...input,
        title: input.title.slice(0, 160),
        description: input.description.slice(0, 10_000),
        companyName: input.companyName?.slice(0, 160),
        source: "mailwin",
      },
      idempotencyKey,
    );
  }

  logActivity(input: CrmActivityInput, idempotencyKey?: string) {
    return this.call<{ id: string }>(
      "POST",
      "/activities",
      {
        ...input,
        subject: input.subject?.slice(0, 200),
        summary: input.summary.slice(0, 10_000) || "(ohne Inhalt)",
        // Das CRM verlangt eine Zeitzone – toISOString() liefert UTC mit „Z“
        occurredAt: input.occurredAt.toISOString(),
        externalId: input.externalId.slice(0, 200),
      },
      idempotencyKey,
    );
  }
}
