"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/auth/session";
import { hasFeature } from "@/lib/features";
import { enqueue } from "@/lib/jobs/queue";
import { ImapProvider } from "@/lib/mail/imap";
import { PRESETS, type ImapSettings } from "@/lib/mail/imap-presets";

export type MailboxState = { error?: string; message?: string } | null;

/** Verbindet ein IMAP/SMTP-Postfach. Die Zugangsdaten werden vor dem Speichern am Server geprüft. */
export async function connectImapAction(_prev: MailboxState, form: FormData): Promise<MailboxState> {
  const user = await requireUser();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  if (!password) return { error: "Bitte das Passwort bzw. App-Passwort angeben." };

  const existing = await db.select({ email: schema.connectedAccounts.emailAddress }).from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id));
  if (existing.length && !existing.some((a) => a.email === email) && !hasFeature(user, "additional_mailboxes")) {
    return { error: "Weitere Postfächer sind in deinem Tarif nicht freigeschaltet." };
  }

  const presetKey = String(form.get("preset") ?? "custom");
  const preset = PRESETS.find((p) => p.key === presetKey);
  const num = (k: string, d: number) => Number(form.get(k) || d);
  const settings: ImapSettings = preset
    ? { ...preset.settings, username: String(form.get("username") || email).trim() }
    : {
        imapHost: String(form.get("imapHost") ?? "").trim(),
        imapPort: num("imapPort", 993),
        imapSecure: num("imapPort", 993) === 993,
        smtpHost: String(form.get("smtpHost") ?? "").trim(),
        smtpPort: num("smtpPort", 587),
        smtpSecure: num("smtpPort", 587) === 465,
        username: String(form.get("username") || email).trim(),
        appendSent: form.get("appendSent") !== "off",
      };
  if (!settings.imapHost || !settings.smtpHost) return { error: "Bitte Posteingangs- und Postausgangsserver angeben." };

  try {
    await new ImapProvider(settings, password, email).verify();
  } catch (err) {
    await audit({ userId: user.id, actor: "user", action: "connect_account", status: "failed", details: { provider: "imap", host: settings.imapHost, error: (err as Error).message } });
    return { error: `Verbindung fehlgeschlagen: ${(err as Error).message}` };
  }

  const values = {
    settings: settings as unknown as Record<string, unknown>,
    credentialsEnc: encrypt(password),
    status: "active" as const,
    lastError: null,
    syncCursor: null,
    displayName: user.name,
    updatedAt: new Date(),
  };
  const [account] = await db
    .insert(schema.connectedAccounts)
    .values({ userId: user.id, provider: "imap", emailAddress: email, ...values })
    .onConflictDoUpdate({ target: [schema.connectedAccounts.userId, schema.connectedAccounts.provider, schema.connectedAccounts.emailAddress], set: values })
    .returning();
  await audit({ userId: user.id, accountId: account!.id, actor: "user", action: "connect_account", status: "success", details: { provider: "imap", host: settings.imapHost } });
  await enqueue("sync_account", { accountId: account!.id }, { dedupeKey: `sync:${account!.id}` });
  revalidatePath("/", "layout");
  return { message: `${email} ist verbunden. Die erste Synchronisation läuft im Hintergrund.` };
}
