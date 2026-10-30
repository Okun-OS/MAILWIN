"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { channels } from "@/lib/notify";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { consumeCode, resolveResetToken } from "@/lib/auth/codes";
import { sendResetMail } from "@/lib/auth/reset";
import { createSession, destroyAllSessions, destroySession, getSessionState, markSessionVerified } from "@/lib/auth/session";
import { sendLoginCode } from "@/lib/auth/twofactor";

export type FormState = { error?: string; message?: string } | null;

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const generic = { error: "E-Mail-Adresse oder Passwort ist falsch." };
  if (!email || !password) return generic;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) {
    await verifyPassword(password, null); // gleiche Antwortzeit wie bei existierenden Konten
    return generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: `Zu viele Fehlversuche. Bitte versuche es nach ${user.lockedUntil.toLocaleTimeString("de-DE", { timeZone: user.timezone, hour: "2-digit", minute: "2-digit" })} Uhr erneut oder setze dein Passwort zurück.` };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await db
      .update(schema.users)
      .set({ failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(schema.users.id, user.id));
    await audit({ userId: user.id, actor: "user", action: "login", status: "failed", details: { reason: "password" } });
    return generic;
  }
  if (user.status !== "active") return { error: "Dieses Konto ist gesperrt. Bitte wende dich an den Support." };

  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  const needsCode = user.twoFactorMethod !== "none";
  await createSession(user.id, { twoFactorVerified: !needsCode });
  await audit({ userId: user.id, actor: "user", action: "login", status: "success", details: { method: "password" } });
  if (needsCode) {
    try {
      await sendLoginCode(user);
    } catch (err) {
      return { error: `Der Anmeldecode konnte nicht gesendet werden: ${(err as Error).message}` };
    }
    redirect("/login/code");
  }
  redirect(user.mustChangePassword ? "/passwort-aendern" : "/");
}

export async function verifyLoginCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  const ok = await consumeCode(state.user.id, "two_factor", String(form.get("code") ?? ""));
  if (!ok) {
    await audit({ userId: state.user.id, actor: "user", action: "login_2fa", status: "failed" });
    return { error: "Der Code ist falsch oder abgelaufen." };
  }
  await markSessionVerified();
  await audit({ userId: state.user.id, actor: "user", action: "login_2fa", status: "success" });
  redirect(state.user.mustChangePassword ? "/passwort-aendern" : "/");
}

export async function resendLoginCodeAction(): Promise<FormState> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.userId, state.user.id), eq(schema.authCodes.purpose, "two_factor"), sql`${schema.authCodes.createdAt} > now() - interval '10 minutes'`));
  if ((recent?.n ?? 0) >= 5) return { error: "Zu viele Codes angefordert. Bitte warte ein paar Minuten." };
  try {
    await sendLoginCode(state.user);
    return { message: "Ein neuer Code ist unterwegs." };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function cancelLoginAction() {
  await destroySession();
  redirect("/login");
}

/** Antwortet immer gleich – verrät nicht, ob es ein Konto gibt. */
export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const done = { message: "Falls es ein Konto mit dieser Adresse gibt, haben wir dir einen Link zum Zurücksetzen geschickt. Er ist 60 Minuten gültig." };
  if (!channels.email) return { error: "Der E-Mail-Versand ist noch nicht eingerichtet. Bitte wende dich an den Support." };
  const [user] = await db.select().from(schema.users).where(and(eq(schema.users.email, email), eq(schema.users.status, "active")));
  if (!user) return done;
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.userId, user.id), eq(schema.authCodes.purpose, "password_reset"), sql`${schema.authCodes.createdAt} > now() - interval '1 hour'`));
  if ((recent?.n ?? 0) >= 3) return done;
  await sendResetMail(user.id, user.email);
  await audit({ userId: user.id, actor: "user", action: "password_reset_requested", status: "success" });
  return done;
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "Die Passwörter stimmen nicht überein." };
  const row = await resolveResetToken(token, false);
  if (!row) return { error: "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an." };
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  const problem = passwordProblem(password, user?.email);
  if (problem) return { error: problem };
  if (!(await resolveResetToken(token, true))) return { error: "Der Link wurde bereits verwendet." };
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(schema.users.id, row.userId));
  await destroyAllSessions(row.userId);
  await audit({ userId: row.userId, actor: "user", action: "password_reset", status: "success" });
  redirect("/login?zurueckgesetzt=1");
}

/** Passwort ändern – auch der Pflichtwechsel nach Startpasswort. */
export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const state = await getSessionState();
  if (!state || !state.session.twoFactorVerified) redirect("/login");
  const { user } = state;
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "Die neuen Passwörter stimmen nicht überein." };
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) return { error: "Das aktuelle Passwort ist falsch." };
  if (current && current === password) return { error: "Das neue Passwort muss sich vom bisherigen unterscheiden." };
  const problem = passwordProblem(password, user.email);
  if (problem) return { error: problem };
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: false, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await destroyAllSessions(user.id, true);
  await audit({ userId: user.id, actor: "user", action: "password_changed", status: "success" });
  if (user.mustChangePassword) redirect("/");
  return { message: "Dein Passwort wurde geändert. Andere Geräte wurden abgemeldet." };
}
