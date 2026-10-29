import { google } from "googleapis";
import { and, eq, gte, lt, notInArray } from "drizzle-orm";
import { db, schema } from "../db";
import { googleAuthFor, type Account } from "../mail/accounts";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export function hasCalendarScope(account: Account): boolean {
  return account.provider === "gmail" && account.scopes.includes(CALENDAR_SCOPE);
}

/** Spiegelt Termine des Hauptkalenders (gestern bis +14 Tage) in die lokale Datenbank. */
export async function syncGoogleCalendar(account: Account): Promise<number> {
  if (!hasCalendarScope(account)) return 0;
  const calendar = google.calendar({ version: "v3", auth: googleAuthFor(account) });
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + 14 * 86_400_000);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  const items = (res.data.items ?? []).filter((e) => e.id && e.status !== "cancelled" && (e.start?.dateTime || e.start?.date));
  for (const e of items) {
    const allDay = !e.start?.dateTime;
    const startsAt = new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00`);
    const endsAt = new Date(e.end?.dateTime ?? `${e.end?.date ?? e.start?.date}T00:00:00`);
    const conference = e.conferenceData?.conferenceSolution?.name ?? (e.hangoutLink ? "Google Meet" : null);
    const values = { title: e.summary ?? "(Ohne Titel)", location: e.location ?? null, conferenceProvider: conference, startsAt, endsAt, allDay };
    await db
      .insert(schema.calendarEvents)
      .values({ userId: account.userId, accountId: account.id, providerEventId: e.id!, ...values })
      .onConflictDoUpdate({ target: [schema.calendarEvents.accountId, schema.calendarEvents.providerEventId], set: values });
  }
  // Im Fenster entfernte Termine löschen
  const keep = items.map((e) => e.id!);
  await db
    .delete(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.accountId, account.id),
        gte(schema.calendarEvents.startsAt, from),
        lt(schema.calendarEvents.startsAt, to),
        ...(keep.length ? [notInArray(schema.calendarEvents.providerEventId, keep)] : []),
      ),
    );
  return items.length;
}
