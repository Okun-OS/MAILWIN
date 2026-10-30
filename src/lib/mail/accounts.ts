import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { decrypt, encrypt } from "../crypto";
import { oauthClient } from "../auth/google-oauth";
import { GmailProvider } from "./gmail";
import { ImapProvider } from "./imap";
import { MicrosoftProvider } from "./microsoft";
import { MicrosoftAuthError, refreshMicrosoftToken } from "../auth/microsoft-oauth";
import type { ImapSettings } from "./imap-presets";
import { ReauthRequiredError, type MailProvider } from "./types";

export type Account = typeof schema.connectedAccounts.$inferSelect;

/** Austauschbar für Tests (Fake-Anbieter ohne Netzwerk). */
let providerFactory: (account: Account) => MailProvider = defaultProviderFactory;
export function setProviderFactory(factory: ((account: Account) => MailProvider) | null) {
  providerFactory = factory ?? defaultProviderFactory;
}

export function googleAuthFor(account: Account) {
  if (!account.refreshTokenEnc) throw new ReauthRequiredError();
  const client = oauthClient();
  client.setCredentials({
    refresh_token: decrypt(account.refreshTokenEnc),
    access_token: account.accessTokenEnc ? decrypt(account.accessTokenEnc) : undefined,
    expiry_date: account.tokenExpiresAt?.getTime(),
  });
  // Erneuerte Zugangstoken verschlüsselt zurückschreiben
  client.on("tokens", (tokens) => {
    void db
      .update(schema.connectedAccounts)
      .set({
        ...(tokens.access_token ? { accessTokenEnc: encrypt(tokens.access_token) } : {}),
        ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
        ...(tokens.expiry_date ? { tokenExpiresAt: new Date(tokens.expiry_date) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.connectedAccounts.id, account.id))
      .catch((err) => console.error("Token konnte nicht gespeichert werden", err));
  });
  return client;
}

/** Liefert ein gültiges Microsoft-Zugangstoken; erneuert es bei Bedarf und speichert das neue (rotierende) Refresh-Token. */
export function microsoftTokenGetter(account: Account): () => Promise<string> {
  let access = account.accessTokenEnc ? decrypt(account.accessTokenEnc) : null;
  let expires = account.tokenExpiresAt?.getTime() ?? 0;
  let refresh = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null;
  return async () => {
    if (access && expires - Date.now() > 120_000) return access;
    if (!refresh) throw new ReauthRequiredError();
    try {
      const t = await refreshMicrosoftToken(refresh);
      access = t.access_token;
      expires = Date.now() + t.expires_in * 1000;
      refresh = t.refresh_token ?? refresh;
      await db
        .update(schema.connectedAccounts)
        .set({ accessTokenEnc: encrypt(access), refreshTokenEnc: encrypt(refresh), tokenExpiresAt: new Date(expires), updatedAt: new Date() })
        .where(eq(schema.connectedAccounts.id, account.id));
      return access;
    } catch (err) {
      if (err instanceof MicrosoftAuthError && ["invalid_grant", "interaction_required", "consent_required"].includes(err.code)) throw new ReauthRequiredError();
      throw err;
    }
  };
}

function defaultProviderFactory(account: Account): MailProvider {
  switch (account.provider) {
    case "gmail":
      return new GmailProvider(googleAuthFor(account));
    case "microsoft":
      return new MicrosoftProvider(microsoftTokenGetter(account));
    case "imap":
      if (!account.credentialsEnc) throw new ReauthRequiredError();
      return new ImapProvider(account.settings as unknown as ImapSettings, decrypt(account.credentialsEnc), account.emailAddress);
    default:
      throw new Error(`Anbieter ${account.provider} ist noch nicht angebunden (geplant für Phase 5).`);
  }
}

export function providerFor(account: Account): MailProvider {
  if (account.status === "reauth_required" || account.status === "disconnected") throw new ReauthRequiredError();
  return providerFactory(account);
}

export async function listAccounts(userId: string): Promise<Account[]> {
  return db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, userId));
}

/** Lädt ein Konto und stellt sicher, dass es dem Nutzer gehört (strikte Datentrennung). */
export async function getOwnedAccount(userId: string, accountId: string): Promise<Account> {
  const [account] = await db
    .select()
    .from(schema.connectedAccounts)
    .where(and(eq(schema.connectedAccounts.id, accountId), eq(schema.connectedAccounts.userId, userId)));
  if (!account) throw new Error("Konto nicht gefunden.");
  return account;
}

/** Markiert ein Konto, dessen Token widerrufen/abgelaufen ist, und benachrichtigt den Nutzer. */
export async function markReauthRequired(account: Account, reason: string): Promise<void> {
  if (account.status === "reauth_required") return;
  await db
    .update(schema.connectedAccounts)
    .set({ status: "reauth_required", lastError: reason, updatedAt: new Date() })
    .where(eq(schema.connectedAccounts.id, account.id));
  await db.insert(schema.notifications).values({
    userId: account.userId,
    kind: "sync_error",
    priority: "high",
    title: `${account.emailAddress} muss neu verbunden werden`,
    body: "Der Zugriff ist abgelaufen oder wurde widerrufen. Automationen für dieses Konto pausieren, bis es neu verbunden ist.",
    link: "/einstellungen",
  });
}
