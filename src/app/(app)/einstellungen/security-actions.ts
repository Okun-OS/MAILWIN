"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, destroyAllSessions } from "@/lib/auth/session";
import { consumeCode, issueCode } from "@/lib/auth/codes";
import { verifyPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/twofactor";
import { channels, notify, systemMail } from "@/lib/notify";

export type SecurityState = { error?: string; message?: string; awaitingCode?: "email" | "sms" } | null;

/** Schritt 1: Methode wählen → Bestätigungscode an E-Mail bzw. Handynummer. */
export async function startTwoFactorAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const user = await requireUser();
  const method = form.get("method") === "sms" ? "sms" : "email";
  try {
    if (method === "sms") {
      if (!channels.sms) return { error: "SMS-Versand ist noch nicht eingerichtet." };
      const phone = normalizePhone(String(form.get("phone") ?? ""));
      if (!phone) return { error: "Bitte eine gültige Handynummer angeben, z. B. +49 151 23456789." };
      const code = await issueCode(user.id, "verify_phone", { channel: "sms", target: phone });
      await notify.sms(phone, `${code} ist dein Bestätigungscode für OKUN Mailwin.`);
    } else {
      if (!channels.email) return { error: "E-Mail-Versand ist noch nicht eingerichtet." };
      const code = await issueCode(user.id, "verify_email_2fa", { channel: "email", target: user.email });
      const mail = systemMail("Zwei-Faktor-Anmeldung bestätigen", [`Dein Bestätigungscode lautet: ${code}`, "Er ist 10 Minuten gültig."]);
      await notify.email(user.email, `${code} – Bestätigungscode für Mailwin`, mail.text, mail.html);
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
  return { awaitingCode: method, message: method === "sms" ? "Wir haben dir eine SMS mit einem Code geschickt." : "Wir haben dir einen Code per E-Mail geschickt." };
}

/** Schritt 2: Code bestätigen → 2FA aktiv. */
export async function confirmTwoFactorAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const user = await requireUser();
  const method = form.get("method") === "sms" ? "sms" : "email";
  const row = await consumeCode(user.id, method === "sms" ? "verify_phone" : "verify_email_2fa", String(form.get("code") ?? ""));
  if (!row) return { awaitingCode: method, error: "Der Code ist falsch oder abgelaufen." };
  await db
    .update(schema.users)
    .set({ twoFactorMethod: method, ...(method === "sms" ? { phone: row.target } : {}), updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await audit({ userId: user.id, actor: "user", action: "two_factor_enabled", status: "success", details: { method } });
  revalidatePath("/einstellungen");
  return { message: "Zwei-Faktor-Anmeldung ist aktiv." };
}

export async function disableTwoFactorAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const user = await requireUser();
  if (user.passwordHash && !(await verifyPassword(String(form.get("password") ?? ""), user.passwordHash))) {
    return { error: "Das Passwort ist falsch." };
  }
  await db.update(schema.users).set({ twoFactorMethod: "none", updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  await audit({ userId: user.id, actor: "user", action: "two_factor_disabled", status: "success" });
  revalidatePath("/einstellungen");
  return { message: "Zwei-Faktor-Anmeldung wurde ausgeschaltet." };
}

export async function logoutOtherSessionsAction() {
  const user = await requireUser();
  await destroyAllSessions(user.id, true);
  await audit({ userId: user.id, actor: "user", action: "logout_everywhere", status: "success" });
  revalidatePath("/einstellungen");
}
