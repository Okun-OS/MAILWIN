import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { aiConfigured } from "../ai";
import { audit } from "../audit";
import { hasFeature } from "../features";
import { createConversation, runMarvinTurn } from "../marvin/agent";

export interface FollowUpJob {
  integrationId: string;
  threadId: string;
  leadId: string;
  leadTitle: string;
  action: { type: string; title: string; reason: string | null; dueAt: string | null };
}

/**
 * Webhook lead.next_action_due (Ablauf H): Marvin liest die Konversation, schlägt im CRM nach und legt einen
 * Nachfass-Entwurf zur Freigabe an – nie ein automatischer Versand. Ohne Marvin oder ohne Sendeberechtigung
 * entsteht stattdessen eine Aufgabe.
 */
export async function prepareFollowUp(job: FollowUpJob): Promise<"draft" | "task" | "skipped"> {
  const [row] = await db
    .select({ integration: schema.integrations, user: schema.users })
    .from(schema.integrations)
    .innerJoin(schema.users, eq(schema.users.id, schema.integrations.userId))
    .where(eq(schema.integrations.id, job.integrationId));
  if (!row) return "skipped";
  const { user } = row;
  const [t] = await db
    .select({ thread: schema.emailThreads, account: schema.connectedAccounts })
    .from(schema.emailThreads)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.emailThreads.accountId))
    .where(eq(schema.emailThreads.id, job.threadId));
  if (!t || t.thread.userId !== user.id) return "skipped";
  const { thread, account } = t;
  const reason = job.action.reason ? ` (Begründung im CRM: ${job.action.reason})` : "";

  const canDraft = aiConfigured() && hasFeature(user, "marvin") && account.status === "active" && account.permissionLevel === "communicate";
  if (canDraft) {
    const conversation = await createConversation(user.id);
    const text =
      `[Systemhinweis von Mailwin] Das OKUN CRM meldet für den Lead „${job.leadTitle}“ den fälligen Schritt „${job.action.title}“${reason}. ` +
      `Lies die Konversation „${thread.subject ?? "(ohne Betreff)"}“ (thread_id ${thread.id}) und schlage mit crm_lookup den aktuellen Stand im CRM nach. ` +
      "Bereite dann eine kurze, freundliche Antwort als Entwurf zur Freigabe vor (draft_email als Antwort auf die letzte Nachricht). Sende nichts. " +
      "Passt ein Nachfassen nicht mehr, etwa weil der Kunde inzwischen geantwortet hat, bereite keinen Entwurf vor und erkläre kurz, warum.";
    const result = await runMarvinTurn(user, conversation.id, text);
    // Titel erst danach setzen – der erste Schritt übernimmt sonst den Anfang des Systemhinweises
    await db.update(schema.marvinConversations).set({ title: `CRM: ${job.action.title} – ${job.leadTitle}`.slice(0, 80) }).where(eq(schema.marvinConversations.id, conversation.id));
    if (!result.error) {
      await db.insert(schema.notifications).values({
        userId: user.id,
        kind: "crm_update",
        priority: "high",
        title: `Nachfassen fällig: ${job.leadTitle}`,
        body: `Im CRM fällig: ${job.action.title}. Marvin hat die Konversation geprüft und – falls passend – einen Entwurf zur Freigabe vorbereitet.`,
        link: `/marvin/${conversation.id}`,
      });
      await audit({ userId: user.id, actor: "automation", action: "crm_followup_draft", targetType: "thread", targetId: thread.id, status: "success", details: { leadId: job.leadId, action: job.action.title } });
      return "draft";
    }
  }

  // Ersatz: Aufgabe an der Konversation
  await db.insert(schema.tasks).values({
    userId: user.id,
    title: `${job.action.title}: ${job.leadTitle}`.slice(0, 200),
    description: `Fällig laut OKUN CRM${reason}.`,
    dueAt: job.action.dueAt ? new Date(job.action.dueAt) : new Date(),
    priority: "important",
    threadId: thread.id,
  });
  await db.insert(schema.notifications).values({
    userId: user.id,
    kind: "crm_update",
    priority: "high",
    title: `Im CRM fällig: ${job.action.title}`,
    body: `${job.leadTitle} – als Aufgabe angelegt.`,
    link: `/emails/${thread.id}`,
  });
  await audit({ userId: user.id, actor: "automation", action: "crm_followup_task", targetType: "thread", targetId: thread.id, status: "success", details: { leadId: job.leadId, action: job.action.title } });
  return "task";
}
