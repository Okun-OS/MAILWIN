"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { sendEmail, threadAction } from "@/lib/mail/actions";
import { parseAddressList } from "@/lib/mail/mime";
import { getOwnedAccount } from "@/lib/mail/accounts";
import { approve, reject } from "@/lib/approvals";
import { enqueue } from "@/lib/jobs/queue";
import { createConversation, getOwnedConversation, runMarvinTurn } from "@/lib/marvin/agent";

export type ActionState = { ok?: boolean; error?: string; message?: string } | null;

const errorMessage = (err: unknown) => (err instanceof z.ZodError ? "Bitte die Eingaben prüfen." : err instanceof Error ? err.message : String(err));

// ───────────── E-Mails ─────────────

export async function sendEmailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let threadId: string;
  try {
    const to = parseAddressList(String(form.get("to") ?? ""));
    if (!to.length) return { error: "Bitte mindestens einen gültigen Empfänger angeben." };
    const result = await sendEmail(
      user.id,
      {
        accountId: String(form.get("accountId")),
        to,
        cc: parseAddressList(String(form.get("cc") ?? "")),
        subject: String(form.get("subject") ?? "").trim(),
        body: String(form.get("body") ?? ""),
        replyToEmailId: (form.get("replyToEmailId") as string) || undefined,
        forwardEmailId: (form.get("forwardEmailId") as string) || undefined,
      },
      "user",
    );
    threadId = result.threadId;
  } catch (err) {
    return { error: `Senden fehlgeschlagen: ${errorMessage(err)}` };
  }
  revalidatePath("/emails");
  redirect(`/emails/${threadId}?gesendet=1`);
}

export async function threadActionForm(threadId: string, op: "archive" | "trash" | "read" | "unread") {
  const user = await requireUser();
  await threadAction(user.id, threadId, op, "user");
  revalidatePath("/emails");
  revalidatePath(`/emails/${threadId}`);
  if (op === "archive" || op === "trash") redirect("/emails");
}

// ───────────── Freigaben ─────────────

export async function approveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(form.get("id"));
  const edits: Record<string, unknown> = {};
  if (form.has("subject")) edits.subject = String(form.get("subject")).trim();
  if (form.has("body")) edits.body = String(form.get("body"));
  if (form.has("to")) edits.to = parseAddressList(String(form.get("to")));
  if (form.has("cc")) edits.cc = parseAddressList(String(form.get("cc")));
  try {
    const result = await approve(user.id, id, Object.keys(edits).length ? edits : undefined);
    revalidatePath("/", "layout");
    return result.ok ? { ok: true, message: "Ausgeführt." } : { error: `Ausführung fehlgeschlagen: ${result.error}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function rejectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await reject(user.id, String(form.get("id")));
    revalidatePath("/", "layout");
    return { ok: true, message: "Abgelehnt – nichts wurde ausgeführt." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ───────────── Aufgaben ─────────────

export async function createTaskAction(form: FormData) {
  const user = await requireUser();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return;
  const projectId = (form.get("projectId") as string) || null;
  if (projectId) await ownedProject(user.id, projectId);
  const due = String(form.get("dueAt") ?? "");
  await db.insert(schema.tasks).values({
    userId: user.id,
    title,
    projectId,
    priority: (form.get("priority") as "urgent" | "important" | "normal" | "low") || "normal",
    dueAt: due ? new Date(due) : null,
  });
  revalidatePath("/", "layout");
}

export async function toggleTaskAction(taskId: string) {
  const user = await requireUser();
  const [task] = await db.select().from(schema.tasks).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)));
  if (!task) return;
  const done = task.status !== "done";
  await db
    .update(schema.tasks)
    .set({ status: done ? "done" : "open", completedAt: done ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.tasks.id, taskId));
  revalidatePath("/", "layout");
}

// ───────────── Marvin ─────────────

export async function marvinSendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const text = String(form.get("text") ?? "").trim();
  if (!text) return null;
  let conversationId = (form.get("conversationId") as string) || "";
  const projectId = (form.get("projectId") as string) || undefined;
  if (conversationId) await getOwnedConversation(user.id, conversationId);
  else {
    if (projectId) await ownedProject(user.id, projectId);
    conversationId = (await createConversation(user.id, projectId)).id;
  }
  const result = await runMarvinTurn(user, conversationId, text);
  revalidatePath("/", "layout");
  if (!form.get("conversationId") && !projectId) redirect(`/marvin/${conversationId}`);
  return result.error ? { error: result.error } : { ok: true };
}

// ───────────── Projekte ─────────────

async function ownedProject(userId: string, projectId: string) {
  const [p] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  if (!p) throw new Error("Projekt nicht gefunden.");
  return p;
}

/** Projektstart im Gespräch: Ziel beschreiben → Projekt + Marvin-Kontext entstehen, Marvin plant mit. */
export async function startProjectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const goal = String(form.get("goal") ?? "").trim();
  if (goal.length < 8) return { error: "Beschreib mir dein Vorhaben in ein, zwei Sätzen." };
  const [project] = await db
    .insert(schema.projects)
    .values({ userId: user.id, name: goal.length > 60 ? `${goal.slice(0, 57)}…` : goal, goal, status: "planning" })
    .returning();
  const conversation = await createConversation(user.id, project!.id);
  await audit({ userId: user.id, actor: "user", action: "create_project", targetType: "project", targetId: project!.id, status: "success" });
  await runMarvinTurn(user, conversation.id, `Neues Projekt: ${goal}\n\nBitte hilf mir, dieses Vorhaben zu planen.`);
  redirect(`/projekte/${project!.id}`);
}

export async function updateProjectStatusAction(projectId: string, status: "planning" | "active" | "waiting" | "done" | "archived") {
  const user = await requireUser();
  await ownedProject(user.id, projectId);
  await db.update(schema.projects).set({ status, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
  revalidatePath("/", "layout");
}

// ───────────── Konten & Einstellungen ─────────────

export async function setPermissionLevelAction(accountId: string, level: "read" | "organize" | "communicate") {
  const user = await requireUser();
  const account = await getOwnedAccount(user.id, accountId);
  await db.update(schema.connectedAccounts).set({ permissionLevel: level, updatedAt: new Date() }).where(eq(schema.connectedAccounts.id, account.id));
  await audit({ userId: user.id, accountId, actor: "user", action: "set_permission_level", status: "success", details: { from: account.permissionLevel, to: level } });
  revalidatePath("/einstellungen");
}

export async function syncNowAction(accountId: string) {
  const user = await requireUser();
  await getOwnedAccount(user.id, accountId);
  await enqueue("sync_account", { accountId }, { dedupeKey: `sync:${accountId}` });
  revalidatePath("/einstellungen");
}

/** Trennt ein Konto: Zugangsdaten werden gelöscht, synchronisierte Daten entfernt. */
export async function disconnectAccountAction(accountId: string) {
  const user = await requireUser();
  const account = await getOwnedAccount(user.id, accountId);
  await db.delete(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, account.id));
  await audit({ userId: user.id, actor: "user", action: "disconnect_account", status: "success", details: { email: account.emailAddress } });
  revalidatePath("/", "layout");
}

export async function saveSignatureAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const accountId = (form.get("accountId") as string) || null;
  if (accountId) await getOwnedAccount(user.id, accountId);
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { error: "Die Signatur ist leer." };
  const html = text
    .split("\n")
    .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>");
  const name = String(form.get("name") ?? "").trim() || "Standard";
  const existing = await db
    .select()
    .from(schema.signatures)
    .where(and(eq(schema.signatures.userId, user.id), accountId ? eq(schema.signatures.accountId, accountId) : isNull(schema.signatures.accountId)));
  if (existing[0]) {
    await db.update(schema.signatures).set({ name, text, html, isDefault: true }).where(eq(schema.signatures.id, existing[0].id));
  } else {
    await db.insert(schema.signatures).values({ userId: user.id, accountId, name, text, html, isDefault: true });
  }
  revalidatePath("/einstellungen");
  return { ok: true, message: "Signatur gespeichert. Sie wird beim Versand automatisch angehängt." };
}

export async function setTimezoneAction(form: FormData) {
  const user = await requireUser();
  const tz = String(form.get("timezone") ?? "");
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
  } catch {
    return;
  }
  await db.update(schema.users).set({ timezone: tz, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  revalidatePath("/", "layout");
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  revalidatePath("/", "layout");
}
