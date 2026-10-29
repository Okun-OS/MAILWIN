import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { displayName, relativeDate } from "@/lib/ui/format";

// In Unterabfragen voll qualifiziert, sonst löst Postgres "id" gegen die innere Tabelle auf
const THREAD_ID = sql.raw(`"email_threads"."id"`);

export const metadata = { title: "Suche" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").trim();
  const like = `%${q}%`;
  const [threads, contacts, tasks, projects] = q
    ? await Promise.all([
        db
          .select({ t: schema.emailThreads, from: sql<{ name?: string; email: string } | null>`(select e."from" from ${schema.emails} e where e.thread_id = ${THREAD_ID} order by e.received_at desc limit 1)` })
          .from(schema.emailThreads)
          .where(
            and(
              eq(schema.emailThreads.userId, user.id),
              or(
                ilike(schema.emailThreads.subject, like),
                sql`exists (select 1 from ${schema.emails} e where e.thread_id = ${THREAD_ID} and (e.body_text ilike ${like} or e."from"->>'email' ilike ${like} or e."from"->>'name' ilike ${like}))`,
              ),
            ),
          )
          .orderBy(desc(schema.emailThreads.lastMessageAt))
          .limit(15),
        db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, user.id), or(ilike(schema.contacts.name, like), ilike(schema.contacts.email, like)))).limit(10),
        db.select().from(schema.tasks).where(and(eq(schema.tasks.userId, user.id), ilike(schema.tasks.title, like))).limit(10),
        db.select().from(schema.projects).where(and(eq(schema.projects.userId, user.id), or(ilike(schema.projects.name, like), ilike(schema.projects.goal, like)))).limit(10),
      ])
    : [[], [], [], []];
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Suche</h1>
          <p>E-Mails, Kontakte, Aufgaben und Projekte</p>
        </div>
      </div>
      <form action="/suche" className="card card-pad" style={{ marginBottom: 20 }}>
        <input className="input" name="q" defaultValue={q} placeholder="Suchbegriff" autoFocus />
      </form>
      {q && (
        <div className="split" style={{ alignItems: "start" }}>
          <section className="card">
            <div className="card-head" style={{ padding: "16px 18px 0" }}><h2>E-Mails ({threads.length})</h2></div>
            <div className="list">
              {threads.map(({ t, from }) => (
                <Link key={t.id} href={`/emails/${t.id}`} className="list-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <span style={{ minWidth: 0 }}>
                    <div className="subj">{t.subject || "(ohne Betreff)"}</div>
                    <div className="snip">{displayName(from)} · {t.snippet}</div>
                  </span>
                  <span className="meta">{relativeDate(t.lastMessageAt, user.timezone)}</span>
                </Link>
              ))}
              {!threads.length && <div className="empty">Keine E-Mails gefunden.</div>}
            </div>
          </section>
          <div className="stack">
            <section className="card card-pad">
              <div className="card-head"><h2>Kontakte ({contacts.length})</h2></div>
              {contacts.map((c) => (
                <div key={c.id} style={{ padding: "6px 0" }}>
                  <b>{c.name ?? c.email}</b> <span className="muted small">{c.email}</span> <Link className="link-more" href={`/emails/neu?an=${encodeURIComponent(c.email)}`}>schreiben</Link>
                </div>
              ))}
              {!contacts.length && <p className="muted small">Keine Kontakte gefunden.</p>}
            </section>
            <section className="card card-pad">
              <div className="card-head"><h2>Aufgaben & Projekte</h2></div>
              {projects.map((p) => <div key={p.id} style={{ padding: "6px 0" }}><Link href={`/projekte/${p.id}`}><b>{p.name}</b></Link> <span className="badge">Projekt</span></div>)}
              {tasks.map((t) => <div key={t.id} style={{ padding: "6px 0" }}>{t.title} <span className="badge">Aufgabe</span></div>)}
              {!projects.length && !tasks.length && <p className="muted small">Keine Treffer.</p>}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
