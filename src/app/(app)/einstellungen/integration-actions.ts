"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/auth/session";
import { hasFeature } from "@/lib/features";
import { normalizeBaseUrl, OkunCrmClient } from "@/lib/crm/okun";
import { CrmError } from "@/lib/crm/types";
import type { CrmSettings } from "@/lib/db/schema";

export type CrmState = { error?: string; message?: string; secret?: string; values?: Record<string, string> } | null;

const crmProblem = (err: unknown) =>
  err instanceof CrmError
    ? err.status === 401 || err.status === 403
      ? "Der API-Schlüssel wurde vom CRM abgelehnt. Bitte im CRM einen neuen Schlüssel erzeugen."
      : err.status === 0
        ? `Das CRM ist unter dieser Adresse nicht erreichbar (${err.message}).`
        : err.status === 404
          ? "Unter dieser Adresse wurde keine Mailwin-Schnittstelle gefunden. Bitte die Adresse des CRM prüfen."
          : `Das CRM meldet einen Fehler: ${err.message}`
    : err instanceof Error
      ? err.message
      : String(err);

async function ownIntegration(userId: string) {
  const [row] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.kind, "okun_crm")));
  if (!row) throw new Error("Es ist kein CRM verbunden.");
  return row;
}

/** Verbindet das OKUN CRM (oder ersetzt den Schlüssel). Der Schlüssel wird vor dem Speichern mit GET /me geprüft. */
export async function connectCrmAction(_prev: CrmState, form: FormData): Promise<CrmState> {
  const user = await requireUser();
  const rawUrl = String(form.get("baseUrl") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const values = { baseUrl: rawUrl };
  if (!hasFeature(user, "crm")) return { error: "Die CRM-Anbindung ist für dein Konto nicht freigeschaltet.", values };
  if (!rawUrl || !apiKey) return { error: "Bitte die Adresse des CRM und den API-Schlüssel angeben.", values };
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(rawUrl);
  } catch (err) {
    return { error: (err as Error).message, values };
  }
  let me;
  try {
    me = await new OkunCrmClient(baseUrl, apiKey).me();
  } catch (err) {
    return { error: crmProblem(err), values };
  }
  const workspace = { workspaceId: me.workspaceId, workspaceName: me.name, workspaceAppUrl: me.appUrl };
  const [existing] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.userId, user.id), eq(schema.integrations.kind, "okun_crm")));
  if (existing && existing.workspaceId && existing.workspaceId !== me.workspaceId) {
    // Anderer Arbeitsbereich: alte Zuordnungen passen nicht mehr
    await db.delete(schema.crmThreadLinks).where(eq(schema.crmThreadLinks.integrationId, existing.id));
    await db.delete(schema.crmActivities).where(eq(schema.crmActivities.integrationId, existing.id));
  }
  await db
    .insert(schema.integrations)
    .values({ userId: user.id, kind: "okun_crm", baseUrl, apiKeyEnc: encrypt(apiKey), status: "active", ...workspace })
    .onConflictDoUpdate({
      target: [schema.integrations.userId, schema.integrations.kind],
      set: { baseUrl, apiKeyEnc: encrypt(apiKey), status: "active", lastError: null, updatedAt: new Date(), ...workspace },
    });
  await audit({ userId: user.id, actor: "user", action: existing ? "crm_update_key" : "crm_connect", targetType: "integration", status: "success", details: { workspace: me.name, baseUrl } });
  revalidatePath("/einstellungen");
  return { message: `Verbunden mit „${me.name}“.` };
}

export async function updateCrmSettingsAction(_prev: CrmState, form: FormData): Promise<CrmState> {
  const user = await requireUser();
  const integration = await ownIntegration(user.id);
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = String(form.get(key) ?? "");
    return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const settings: CrmSettings = {
    logMode: pick("logMode", ["off", "linked", "known_contacts"] as const, integration.settings.logMode),
    leadMode: pick("leadMode", ["approval", "direct"] as const, integration.settings.leadMode),
    content: pick("content", ["preview", "full"] as const, integration.settings.content),
  };
  await db.update(schema.integrations).set({ settings, updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
  await audit({ userId: user.id, actor: "user", action: "crm_settings", targetType: "integration", targetId: integration.id, status: "success", details: settings });
  revalidatePath("/einstellungen");
  return { message: "Gespeichert." };
}

/** Prüft die Verbindung erneut (z. B. nach einer Unterbrechung) und aktualisiert den Arbeitsbereich. */
export async function checkCrmAction(_prev: CrmState, _form: FormData): Promise<CrmState> {
  const user = await requireUser();
  const integration = await ownIntegration(user.id);
  try {
    const me = await new OkunCrmClient(integration.baseUrl, decrypt(integration.apiKeyEnc)).me();
    await db
      .update(schema.integrations)
      .set({ status: "active", lastError: null, workspaceName: me.name, workspaceAppUrl: me.appUrl, updatedAt: new Date() })
      .where(eq(schema.integrations.id, integration.id));
    revalidatePath("/einstellungen");
    return { message: `Verbindung zu „${me.name}“ funktioniert.` };
  } catch (err) {
    const message = crmProblem(err);
    if (err instanceof CrmError && (err.status === 401 || err.status === 403)) {
      await db.update(schema.integrations).set({ status: "error", lastError: message, updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
    }
    revalidatePath("/einstellungen");
    return { error: message };
  }
}

/**
 * Webhook-Geheimnis hinterlegen: im CRM erzeugtes Geheimnis einfügen oder hier erzeugen lassen.
 * Ein hier erzeugtes Geheimnis wird genau einmal angezeigt und danach nur verschlüsselt gespeichert.
 */
export async function setWebhookSecretAction(_prev: CrmState, form: FormData): Promise<CrmState> {
  const user = await requireUser();
  const integration = await ownIntegration(user.id);
  const generate = form.get("generate") === "1";
  const secret = generate ? `whsec_${randomBytes(32).toString("base64url")}` : String(form.get("secret") ?? "").trim();
  if (!generate && secret.length < 16) return { error: "Das Geheimnis muss mindestens 16 Zeichen lang sein." };
  await db.update(schema.integrations).set({ webhookSecretEnc: encrypt(secret), updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
  await audit({ userId: user.id, actor: "user", action: "crm_webhook_secret", targetType: "integration", targetId: integration.id, status: "success", details: { generated: generate } });
  revalidatePath("/einstellungen");
  return generate
    ? { secret, message: "Geheimnis erzeugt. Trage es jetzt im CRM ein – es wird hier nur dieses eine Mal angezeigt." }
    : { message: "Geheimnis gespeichert. Mailwin nimmt jetzt Rückmeldungen des CRM an." };
}

export async function removeWebhookSecretAction() {
  const user = await requireUser();
  const integration = await ownIntegration(user.id);
  await db.update(schema.integrations).set({ webhookSecretEnc: null, updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
  revalidatePath("/einstellungen");
}

/** Trennt das CRM. Zuordnungen in Mailwin werden gelöscht; Daten im CRM bleiben unverändert. */
export async function disconnectCrmAction() {
  const user = await requireUser();
  const integration = await ownIntegration(user.id);
  await db.delete(schema.integrations).where(eq(schema.integrations.id, integration.id));
  await audit({ userId: user.id, actor: "user", action: "crm_disconnect", targetType: "integration", targetId: integration.id, status: "success", details: { workspace: integration.workspaceName } });
  revalidatePath("/einstellungen");
}
