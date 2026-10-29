import Link from "next/link";
import { and, desc, eq, gte, ilike, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { listAccounts } from "@/lib/mail/accounts";
import { startOfDayIn } from "@/lib/time";
import { daysSince, displayName, initialsOf, relativeDate } from "@/lib/ui/format";
import { Icon } from "@/components/Icon";

// In Unterabfragen voll qualifiziert, sonst löst Postgres "id" gegen die innere Tabelle auf
const THREAD_ID = sql.raw(`"email_threads"."id"`);

export const metadata = { title: "E-Mails" };

const FILTERS = [
  { key: "", label: "Posteingang" },
  { key: "antworten", label: "Antwort erforderlich" },
  { key: "wartend", label: "Warten auf Antwort" },
  { key: "ungelesen", label: "Ungelesen" },
  { key: "heute", label: "Heute" },
  { key: "gesendet", label: "Gesendet" },
] as const;

const PAGE_SIZE = 40;

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ filter?: string; konto?: string; q?: string; seite?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = sp.filter ?? "";
  const page = Math.max(1, Number(sp.seite ?? 1) || 1);
  const accounts = await listAccounts(user.id);

  const conds: SQL[] = [eq(schema.emailThreads.userId, user.id)];
  if (sp.konto) conds.push(eq(schema.emailThreads.accountId, sp.konto));
  const inLabel = (label: string) =>
    sql`exists (select 1 from ${schema.emails} e where e.thread_id = ${THREAD_ID} and ${label} = any(e.label_ids))`;
  if (filter === "antworten") conds.push(eq(schema.emailThreads.needsReply, true));
  else if (filter === "wartend") conds.push(isNotNull(schema.emailThreads.awaitingReplySince), lte(schema.emailThreads.awaitingReplySince, new Date(Date.now() - 3 * 86_400_000)));
  else if (filter === "ungelesen") conds.push(eq(schema.emailThreads.unread, true), inLabel("INBOX"));
  else if (filter === "heute") conds.push(gte(schema.emailThreads.lastMessageAt, startOfDayIn(new Date(), user.timezone)), inLabel("INBOX"));
  else if (filter === "gesendet") conds.push(inLabel("SENT"));
  else conds.push(inLabel("INBOX"));
  if (sp.q) {
    const q = `%${sp.q}%`;
    conds.push(
      or(
        ilike(schema.emailThreads.subject, q),
        sql`exists (select 1 from ${schema.emails} e where e.thread_id = ${THREAD_ID} and (e.body_text ilike ${q} or e."from"->>'email' ilike ${q} or e."from"->>'name' ilike ${q}))`,
      )!,
    );
  }

  const threads = await db
    .select({
      thread: schema.emailThreads,
      from: sql<{ name?: string; email: string } | null>`(select e."from" from ${schema.emails} e where e.thread_id = ${THREAD_ID} and not e.is_outgoing order by e.received_at desc limit 1)`,
      to: sql<{ name?: string; email: string }[] | null>`(select e."to" from ${schema.emails} e where e.thread_id = ${THREAD_ID} order by e.received_at desc limit 1)`,
      hasAttachments: sql<boolean>`exists (select 1 from ${schema.attachments} a join ${schema.emails} e on e.id = a.email_id where e.thread_id = ${THREAD_ID})`,
    })
    .from(schema.emailThreads)
    .where(and(...conds))
    .orderBy(desc(schema.emailThreads.lastMessageAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasMore = threads.length > PAGE_SIZE;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { filter, konto: sp.konto, q: sp.q, ...patch };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return s ? `/emails?${s}` : "/emails";
  };

  return (
    <>
      <div className="page-title">
        <div>
          <h1>E-Mails</h1>
          <p>{accounts.length > 1 ? "Gemeinsamer Posteingang aller verbundenen Konten" : accounts[0]?.emailAddress ?? "Noch kein Konto verbunden"}</p>
        </div>
        <div className="toolbar">
          <form action="/emails" style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="filter" value={filter} />
            {sp.konto && <input type="hidden" name="konto" value={sp.konto} />}
            <input className="input" name="q" defaultValue={sp.q} placeholder="In E-Mails suchen" style={{ width: 220, height: 40 }} />
          </form>
          <Link href="/emails/neu" className="btn btn-primary">
            <Icon name="pen" size={16} /> Neue E-Mail
          </Link>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <Link key={f.key} href={qs({ filter: f.key || undefined, seite: undefined })} className={filter === f.key ? "active" : undefined}>
            {f.label}
          </Link>
        ))}
        {accounts.length > 1 && (
          <>
            <span style={{ width: 12 }} />
            <Link href={qs({ konto: undefined })} className={!sp.konto ? "active" : undefined}>
              Alle Konten
            </Link>
            {accounts.map((a) => (
              <Link key={a.id} href={qs({ konto: a.id })} className={sp.konto === a.id ? "active" : undefined}>
                {a.emailAddress}
              </Link>
            ))}
          </>
        )}
      </div>

      <section className="card list">
        {!accounts.length ? (
          <div className="empty">
            <b>Noch kein E-Mail-Konto verbunden</b>
            Verbinde dein Gmail-Konto, damit Marvin deine Nachrichten sehen und organisieren kann.
            <Link href="/einstellungen" className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>
              Konto verbinden
            </Link>
          </div>
        ) : !threads.length ? (
          <div className="empty">
            <b>{sp.q ? "Keine Treffer" : "Hier ist alles erledigt"}</b>
            {accounts.every((a) => !a.lastSyncedAt) ? "Die erste Synchronisation läuft – das kann einen Moment dauern." : "In dieser Ansicht gibt es keine Konversationen."}
          </div>
        ) : (
          threads.slice(0, PAGE_SIZE).map(({ thread, from, to, hasAttachments }) => {
            const counterpart = filter === "gesendet" || !from ? to?.[0] ?? null : from;
            return (
              <Link key={thread.id} href={`/emails/${thread.id}`} className={`list-row${thread.unread ? " unread" : ""}`}>
                <span className="initials">{initialsOf(counterpart)}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="who">
                    <b>{displayName(counterpart)}</b>
                    {thread.messageCount > 1 && <span className="small muted">{thread.messageCount}</span>}
                  </span>
                  <div className="subj">{thread.subject || "(ohne Betreff)"}</div>
                  <div className="snip">{thread.snippet}</div>
                </span>
                <span className="meta">
                  <span>{relativeDate(thread.lastMessageAt, user.timezone)}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {hasAttachments && <Icon name="paperclip" size={14} />}
                    {thread.needsReply && <span className="badge badge-red">Antwort erforderlich</span>}
                    {thread.awaitingReplySince && daysSince(thread.awaitingReplySince) >= 3 && (
                      <span className="badge badge-blue">wartet seit {daysSince(thread.awaitingReplySince)} Tagen</span>
                    )}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </section>
      {(page > 1 || hasMore) && (
        <div className="toolbar" style={{ justifyContent: "center", marginTop: 16 }}>
          {page > 1 && (
            <Link className="btn btn-sm" href={qs({ seite: String(page - 1) })}>
              Zurück
            </Link>
          )}
          {hasMore && (
            <Link className="btn btn-sm" href={qs({ seite: String(page + 1) })}>
              Weitere
            </Link>
          )}
        </div>
      )}
    </>
  );
}
