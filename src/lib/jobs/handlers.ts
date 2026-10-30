import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { syncAccount } from "../mail/sync";
import { syncGoogleCalendar, syncMicrosoftCalendar } from "../calendar/google";
import { ReauthRequiredError } from "../mail/types";
import { enqueue, type Job } from "./queue";

export class PermanentJobError extends Error {}

export const handlers: Record<string, (job: Job) => Promise<void>> = {
  async sync_account(job) {
    const [account] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, String(job.payload.accountId)));
    if (!account || account.status === "disconnected" || account.status === "reauth_required") return;
    try {
      await syncAccount(account);
      if (account.calendarEnabled) {
        if (account.provider === "gmail") await syncGoogleCalendar(account);
        if (account.provider === "microsoft") await syncMicrosoftCalendar(account);
      }
    } catch (err) {
      // Abgelaufene Zugänge nicht endlos wiederholen – der Nutzer wurde benachrichtigt
      if (err instanceof ReauthRequiredError) throw new PermanentJobError(err.message);
      throw err;
    }
  },
};

/** Plant regelmäßige Synchronisationen für alle aktiven Konten. */
export async function scheduleSyncs() {
  const accounts = await db.select({ id: schema.connectedAccounts.id }).from(schema.connectedAccounts).where(eq(schema.connectedAccounts.status, "active"));
  for (const a of accounts) await enqueue("sync_account", { accountId: a.id }, { dedupeKey: `sync:${a.id}` });
}
