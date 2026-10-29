import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { markNotificationsReadAction } from "../actions";

export const metadata = { title: "Benachrichtigungen" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(50);
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Benachrichtigungen</h1>
          <p>Hinweise von Marvin und dem System.</p>
        </div>
        {notes.some((n) => !n.readAt) && (
          <form action={markNotificationsReadAction}>
            <button className="btn btn-sm">Alle als gelesen markieren</button>
          </form>
        )}
      </div>
      <section className="card list">
        {notes.length ? (
          notes.map((n) => {
            const body = (
              <>
                <span className="initials" style={n.priority === "high" ? { background: "var(--mw-red-50)", color: "var(--mw-red-500)" } : undefined}>!</span>
                <span style={{ minWidth: 0 }}>
                  <div className="subj" style={!n.readAt ? { fontWeight: 800 } : undefined}>{n.title}</div>
                  {n.body && <div className="snip">{n.body}</div>}
                </span>
                <span className="meta">{n.createdAt.toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "short", timeStyle: "short" })}</span>
              </>
            );
            return n.link ? <Link key={n.id} href={n.link} className="list-row">{body}</Link> : <div key={n.id} className="list-row">{body}</div>;
          })
        ) : (
          <div className="empty"><b>Keine Benachrichtigungen</b></div>
        )}
      </section>
    </>
  );
}
