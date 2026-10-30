"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin, destroyAllSessions } from "@/lib/auth/session";
import { generatePassword, hashPassword, passwordProblem } from "@/lib/auth/password";
import { sendResetMail } from "@/lib/auth/reset";
import { channels, notify, systemMail } from "@/lib/notify";
import { appUrl } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { deleteUserCompletely } from "@/lib/admin";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { randomBytes } from "node:crypto";

export type AdminState = { error?: string; message?: string; secret?: string } | null;

type User = typeof schema.users.$inferSelect;

async function target(userId: string): Promise<User> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new Error("Kunde nicht gefunden.");
  return u;
}

async function log(admin: User, userId: string, action: string, details: Record<string, unknown> = {}) {
  await audit({ userId, actor: "admin", action, targetType: "user", targetId: userId, status: "success", details: { ...details, admin: admin.email } });
}

const refresh = (userId?: string) => {
  revalidatePath("/admin", "layout");
  if (userId) revalidatePath(`/admin/kunden/${userId}`);
};

// ───────────── Kunden ─────────────

export async function createUserAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim() || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (exists) return { error: "Für diese Adresse gibt es bereits ein Konto." };
  const password = generatePassword();
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      name,
      role: form.get("role") === "admin" ? "admin" : "user",
      plan: (String(form.get("plan") || "trial") as User["plan"]),
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    })
    .returning();
  await log(admin, user!.id, "admin_create_user", { email });
  let mailed = false;
  if (form.get("sendInvite") === "on" && channels.email) {
    const mail = systemMail(
      "Dein Zugang zu OKUN Mailwin",
      [`Hallo${name ? ` ${name}` : ""}, für dich wurde ein Mailwin-Konto angelegt.`, `Anmeldename: ${email}`, `Vorläufiges Passwort: ${password}`, "Bei der ersten Anmeldung legst du ein eigenes Passwort fest."],
      { label: "Jetzt anmelden", url: appUrl("/login").toString() },
    );
    await notify.email(email, "Dein Zugang zu OKUN Mailwin", mail.text, mail.html);
    mailed = true;
  }
  refresh();
  return { message: mailed ? "Konto angelegt und Zugangsdaten per E-Mail verschickt." : "Konto angelegt. Gib das vorläufige Passwort sicher weiter – es wird nur jetzt angezeigt:", secret: password };
}

export async function setPasswordAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const user = await target(String(form.get("userId")));
  const custom = String(form.get("password") ?? "").trim();
  const password = custom || generatePassword();
  if (custom) {
    const problem = passwordProblem(custom, user.email);
    if (problem) return { error: problem };
  }
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: form.get("mustChange") !== "off", failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await destroyAllSessions(user.id);
  await log(admin, user.id, "admin_set_password");
  refresh(user.id);
  return { message: "Neues Passwort gesetzt, alle Sitzungen beendet. Es wird nur jetzt angezeigt:", secret: password };
}

export async function sendResetLinkAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const user = await target(String(form.get("userId")));
  if (!channels.email) return { error: "E-Mail-Versand ist nicht eingerichtet (Resend)." };
  await sendResetMail(user.id, user.email);
  await log(admin, user.id, "admin_send_reset_link");
  return { message: `Link zum Zurücksetzen an ${user.email} geschickt.` };
}

export async function setStatusAction(userId: string, status: "active" | "disabled") {
  const admin = await requireAdmin();
  if (userId === admin.id) throw new Error("Du kannst dich nicht selbst sperren.");
  await db.update(schema.users).set({ status, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  if (status === "disabled") await destroyAllSessions(userId);
  await log(admin, userId, status === "disabled" ? "admin_disable_user" : "admin_enable_user");
  refresh(userId);
}

export async function unlockAction(userId: string) {
  const admin = await requireAdmin();
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
  await log(admin, userId, "admin_unlock_user");
  refresh(userId);
}

export async function logoutUserAction(userId: string) {
  const admin = await requireAdmin();
  await destroyAllSessions(userId);
  await log(admin, userId, "admin_logout_user");
  refresh(userId);
}

export async function resetTwoFactorAction(userId: string) {
  const admin = await requireAdmin();
  await db.update(schema.users).set({ twoFactorMethod: "none", phone: null, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await destroyAllSessions(userId);
  await log(admin, userId, "admin_reset_2fa");
  refresh(userId);
}

export async function setRoleAction(userId: string, role: "user" | "admin") {
  const admin = await requireAdmin();
  if (userId === admin.id && role !== "admin") {
    const [others] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(and(eq(schema.users.role, "admin"), ne(schema.users.id, admin.id)));
    if (!others?.n) throw new Error("Es muss mindestens einen Admin geben.");
  }
  await db.update(schema.users).set({ role, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await log(admin, userId, "admin_set_role", { role });
  refresh(userId);
}

export async function updateProfileAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const user = await target(String(form.get("userId")));
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Ungültige E-Mail-Adresse." };
  if (email !== user.email) {
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (taken) return { error: "Diese E-Mail-Adresse ist bereits vergeben." };
  }
  const ends = String(form.get("subscriptionEndsAt") ?? "");
  await db
    .update(schema.users)
    .set({
      email,
      name: String(form.get("name") ?? "").trim() || null,
      plan: String(form.get("plan")) as User["plan"],
      subscriptionStatus: String(form.get("subscriptionStatus")) as User["subscriptionStatus"],
      subscriptionEndsAt: ends ? new Date(ends) : null,
      adminNote: String(form.get("adminNote") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));
  await log(admin, user.id, "admin_update_profile", { email: email !== user.email ? { von: user.email, zu: email } : undefined });
  refresh(user.id);
  return { message: "Gespeichert." };
}

export async function setFeatureAction(userId: string, key: FeatureKey, enabled: boolean) {
  const admin = await requireAdmin();
  if (!(key in FEATURES)) return;
  const user = await target(userId);
  await db.update(schema.users).set({ features: { ...user.features, [key]: enabled } }).where(eq(schema.users.id, userId));
  await log(admin, userId, "admin_set_feature", { feature: key, enabled });
  refresh(userId);
}

export async function addSupportNoteAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const userId = String(form.get("userId"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Die Notiz ist leer." };
  await target(userId);
  await db.insert(schema.supportNotes).values({ userId, authorId: admin.id, body });
  refresh(userId);
  return { message: "Notiz gespeichert." };
}

export async function resyncAccountAction(accountId: string) {
  await requireAdmin();
  const [account] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, accountId));
  if (!account) return;
  await enqueue("sync_account", { accountId }, { dedupeKey: `sync:${accountId}` });
  refresh(account.userId);
}

export async function deleteUserAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const user = await target(String(form.get("userId")));
  if (user.id === admin.id) return { error: "Du kannst dein eigenes Konto hier nicht löschen." };
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== user.email) return { error: "Zur Bestätigung bitte die E-Mail-Adresse des Kunden genau eintippen." };
  await deleteUserCompletely(user.id, admin.id);
  refresh();
  redirect("/admin/kunden?geloescht=1");
}

// ───────────── Gutscheine & Aktionen ─────────────

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("").replace(/(.{4})/, "$1-");
}

export async function createVoucherAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const code = (String(form.get("code") ?? "").trim().toUpperCase() || randomCode()).replace(/\s/g, "");
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) return { error: "Code: 4–32 Zeichen, nur Buchstaben, Ziffern und Bindestrich." };
  const kind = String(form.get("kind")) as "percent" | "fixed" | "free_months";
  const raw = Number(String(form.get("value") ?? "").replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return { error: "Bitte einen gültigen Wert angeben." };
  if (kind === "percent" && raw > 100) return { error: "Prozent dürfen höchstens 100 sein." };
  const value = kind === "fixed" ? Math.round(raw * 100) : Math.round(raw);
  const max = Number(form.get("maxRedemptions") || 0);
  const from = String(form.get("validFrom") ?? "");
  const until = String(form.get("validUntil") ?? "");
  const [exists] = await db.select({ id: schema.vouchers.id }).from(schema.vouchers).where(eq(schema.vouchers.code, code));
  if (exists) return { error: "Diesen Code gibt es bereits." };
  await db.insert(schema.vouchers).values({
    code,
    kind,
    value,
    description: String(form.get("description") ?? "").trim() || null,
    maxRedemptions: max > 0 ? max : null,
    validFrom: from ? new Date(from) : null,
    validUntil: until ? new Date(`${until}T23:59:59`) : null,
    campaignId: (form.get("campaignId") as string) || null,
  });
  await audit({ userId: admin.id, actor: "admin", action: "admin_create_voucher", status: "success", details: { code } });
  refresh();
  return { message: `Gutschein ${code} angelegt.` };
}

export async function toggleVoucherAction(id: string, active: boolean) {
  await requireAdmin();
  await db.update(schema.vouchers).set({ active }).where(eq(schema.vouchers.id, id));
  refresh();
}

export async function createCampaignAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  const starts = String(form.get("startsAt") ?? "");
  const ends = String(form.get("endsAt") ?? "");
  await db.insert(schema.campaigns).values({
    name,
    description: String(form.get("description") ?? "").trim() || null,
    bannerText: String(form.get("bannerText") ?? "").trim() || null,
    startsAt: starts ? new Date(starts) : null,
    endsAt: ends ? new Date(`${ends}T23:59:59`) : null,
  });
  await audit({ userId: admin.id, actor: "admin", action: "admin_create_campaign", status: "success", details: { name } });
  refresh();
  return { message: `Aktion „${name}“ angelegt.` };
}

export async function toggleCampaignAction(id: string, active: boolean) {
  await requireAdmin();
  await db.update(schema.campaigns).set({ active }).where(eq(schema.campaigns.id, id));
  refresh();
}

// ───────────── Systemmeldungen ─────────────

export async function createAnnouncementAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Bitte einen Titel angeben." };
  const ends = String(form.get("endsAt") ?? "");
  await db.insert(schema.announcements).values({
    title,
    body: String(form.get("body") ?? "").trim() || null,
    level: form.get("level") === "warning" ? "warning" : "info",
    endsAt: ends ? new Date(`${ends}T23:59:59`) : null,
  });
  await audit({ userId: admin.id, actor: "admin", action: "admin_create_announcement", status: "success", details: { title } });
  revalidatePath("/", "layout");
  return { message: "Meldung veröffentlicht – alle Kunden sehen sie oben in der App." };
}

export async function toggleAnnouncementAction(id: string, active: boolean) {
  await requireAdmin();
  await db.update(schema.announcements).set({ active }).where(eq(schema.announcements.id, id));
  revalidatePath("/", "layout");
}

// ───────────── System ─────────────

export async function retryJobAction(id: string) {
  await requireAdmin();
  await db.update(schema.jobs).set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null }).where(eq(schema.jobs.id, id));
  refresh();
}
