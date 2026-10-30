import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { decrypt } from "./crypto";
import { audit } from "./audit";

/**
 * DSGVO-Auskunft (Art. 15/20): alle gespeicherten Daten eines Nutzers als JSON.
 * Zugangstoken und Passwort-Hashes werden bewusst nicht exportiert.
 */
export async function exportUserData(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new Error("Nutzer nicht gefunden.");
  const { passwordHash: _p, ...profile } = user;
  const accounts = (await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, userId))).map(
    ({ accessTokenEnc: _a, refreshTokenEnc: _r, credentialsEnc: _c, ...rest }) => rest,
  );
  const crm = (await db.select().from(schema.integrations).where(eq(schema.integrations.userId, userId))).map(
    ({ apiKeyEnc: _k, webhookSecretEnc: _w, ...rest }) => rest,
  );
  const crmLinks = crm.length
    ? await db.select().from(schema.crmThreadLinks).where(inArray(schema.crmThreadLinks.integrationId, crm.map((i) => i.id)))
    : [];
  const conversations = await db.select().from(schema.marvinConversations).where(eq(schema.marvinConversations.userId, userId));
  const messages = [];
  for (const c of conversations) {
    messages.push(...(await db.select().from(schema.marvinMessages).where(eq(schema.marvinMessages.conversationId, c.id)).orderBy(asc(schema.marvinMessages.seq))));
  }
  return {
    exportiertAm: new Date().toISOString(),
    hinweis: "Datenexport aus OKUN Mailwin. Zugangsdaten zu E-Mail-Konten und zum CRM sind aus Sicherheitsgründen nicht enthalten.",
    profil: profile,
    emailKonten: accounts,
    crmAnbindungen: crm,
    crmZuordnungen: crmLinks,
    konversationen: await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.userId, userId)),
    emails: await db.select().from(schema.emails).where(eq(schema.emails.userId, userId)),
    termine: await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.userId, userId)),
    kontakte: await db.select().from(schema.contacts).where(eq(schema.contacts.userId, userId)),
    projekte: await db.select().from(schema.projects).where(eq(schema.projects.userId, userId)),
    aufgaben: await db.select().from(schema.tasks).where(eq(schema.tasks.userId, userId)),
    signaturen: await db.select().from(schema.signatures).where(eq(schema.signatures.userId, userId)),
    freigaben: await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.userId, userId)),
    marvinUnterhaltungen: conversations,
    marvinNachrichten: messages,
    benachrichtigungen: await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
    protokoll: await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, userId)),
  };
}

/** Widerruft Google-Zugriffe (best effort), damit nach dem Löschen kein Token mehr gültig ist. */
async function revokeGoogleTokens(userId: string) {
  const accounts = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, userId));
  for (const a of accounts) {
    if (a.provider !== "gmail" || !a.refreshTokenEnc) continue;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(a.refreshTokenEnc))}`, { method: "POST" });
    } catch {
      // Widerruf ist ein Zusatz – das Löschen der Daten geht trotzdem weiter
    }
  }
}

/** Löscht einen Nutzer mit allen Daten (DSGVO Art. 17). Alle Tabellen hängen per ON DELETE CASCADE am Nutzer. */
export async function deleteUserCompletely(userId: string, adminId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return;
  await revokeGoogleTokens(userId);
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  // Das Protokoll des Nutzers ist mitgelöscht – der Vorgang wird beim Admin vermerkt
  await audit({ userId: adminId, actor: "admin", action: "admin_delete_user", targetType: "user", targetId: userId, status: "success", details: { email: user.email } });
}
