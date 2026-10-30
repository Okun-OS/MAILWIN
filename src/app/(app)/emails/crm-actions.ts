"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createLeadForThread, linkThread, unlinkThread } from "@/lib/crm/service";
import { CrmError } from "@/lib/crm/types";

export type CrmCardState = { ok?: boolean; error?: string; message?: string } | null;

const problem = (err: unknown) => {
  if (err instanceof CrmError && err.fields) return `${err.message} ${Object.values(err.fields).join(" ")}`;
  return err instanceof Error ? err.message : String(err);
};

/** Lead aus der Konversation anlegen (Ablauf A). */
export async function createLeadAction(_prev: CrmCardState, form: FormData): Promise<CrmCardState> {
  const user = await requireUser();
  const threadId = String(form.get("threadId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Bitte einen Titel angeben." };
  const euros = Number(String(form.get("value") ?? "").replace(/\./g, "").replace(",", "."));
  const [pipelineId, stageId] = String(form.get("stage") ?? "").split("|");
  try {
    await createLeadForThread(
      user.id,
      threadId,
      {
        title: title.slice(0, 160),
        description: String(form.get("description") ?? "").slice(0, 10_000),
        ...(Number.isFinite(euros) && euros > 0 ? { valueCents: Math.round(euros * 100) } : {}),
        ...(pipelineId && stageId ? { pipelineId, stageId } : {}),
        ...(String(form.get("companyName") ?? "").trim() ? { companyName: String(form.get("companyName")).trim() } : {}),
      },
      "user",
    );
  } catch (err) {
    return { error: problem(err) };
  }
  revalidatePath(`/emails/${threadId}`);
  return { ok: true, message: "Lead im CRM angelegt." };
}

/**
 * Zuordnen (Ablauf B: einem offenen Lead oder nur dem Kontakt) bzw. Zuordnung lösen.
 * Fehler (CRM nicht erreichbar, Lead inzwischen geschlossen) kommen als Meldung zurück, statt die Seite abbrechen zu lassen.
 */
export async function crmLinkAction(_prev: CrmCardState, form: FormData): Promise<CrmCardState> {
  const user = await requireUser();
  const threadId = String(form.get("threadId") ?? "");
  try {
    if (form.get("op") === "unlink") await unlinkThread(user.id, threadId);
    else await linkThread(user.id, threadId, (form.get("leadId") as string) || null, "user");
  } catch (err) {
    return { error: problem(err) };
  }
  revalidatePath(`/emails/${threadId}`);
  return { ok: true };
}
