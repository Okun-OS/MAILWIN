import { and, asc, eq, gte, lt } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { addDays, formatTime, startOfDayIn } from "@/lib/time";

export const metadata = { title: "Kalender" };

export default async function CalendarPage() {
  const user = await requireUser();
  const from = startOfDayIn(new Date(), user.timezone);
  const to = addDays(from, 14);
  const [events, accounts] = await Promise.all([
    db
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, user.id), gte(schema.calendarEvents.endsAt, from), lt(schema.calendarEvents.startsAt, to)))
      .orderBy(asc(schema.calendarEvents.startsAt)),
    db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id)),
  ]);
  const days = new Map<string, typeof events>();
  for (const e of events) {
    const key = e.startsAt.toLocaleDateString("en-CA", { timeZone: user.timezone });
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Kalender</h1>
          <p>Die nächsten 14 Tage aus deinem verbundenen Google-Kalender (nur Lesezugriff).</p>
        </div>
      </div>
      {!accounts.some((a) => a.calendarEnabled) ? (
        <div className="card empty"><b>Kein Kalender verbunden</b>Verbinde ein Google-Konto und erlaube den Kalenderzugriff.</div>
      ) : !events.length ? (
        <div className="card empty"><b>Keine Termine</b>In den nächsten 14 Tagen ist nichts eingetragen.</div>
      ) : (
        <div className="stack">
          {[...days.entries()].map(([key, list]) => (
            <section key={key} className="card card-pad">
              <div className="card-head">
                <h2>{list[0]!.startsAt.toLocaleDateString("de-DE", { timeZone: user.timezone, weekday: "long", day: "numeric", month: "long" })}</h2>
              </div>
              <div className="timeline">
                {list.map((e) => (
                  <div key={e.id} className="tl-item">
                    <span className="dot" />
                    <time>{e.allDay ? "Ganztägig" : `${formatTime(e.startsAt, user.timezone)} – ${formatTime(e.endsAt, user.timezone)}`}</time>
                    <div>
                      <b>{e.title}</b>
                      {(e.conferenceProvider || e.location) && <small>{[e.conferenceProvider, e.location].filter(Boolean).join(" · ")}</small>}
                    </div>
                    <span />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
