import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { threadAction } from "@/lib/mail/actions";
import { displayName, initialsOf } from "@/lib/ui/format";
import { Icon } from "@/components/Icon";
import { MailFrame } from "@/components/MailFrame";
import { ActionButton } from "@/components/ConfirmButton";
import { MarvinIcon } from "@/components/Marvin";
import { threadActionForm } from "../../actions";

export default async function ThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bilder?: string; gesendet?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db
    .select({ thread: schema.emailThreads, account: schema.connectedAccounts })
    .from(schema.emailThreads)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.emailThreads.accountId))
    .where(and(eq(schema.emailThreads.id, id), eq(schema.emailThreads.userId, user.id)));
  if (!row) notFound();
  const { thread, account } = row;

  // Beim Öffnen als gelesen markieren – auch beim Anbieter
  if (thread.unread && account.status === "active") {
    await threadAction(user.id, thread.id, "read", "user").catch(() => undefined);
  }

  const messages = await db.select().from(schema.emails).where(eq(schema.emails.threadId, thread.id)).orderBy(asc(schema.emails.receivedAt));
  const atts = messages.length ? await db.select().from(schema.attachments).where(inArray(schema.attachments.emailId, messages.map((m) => m.id))) : [];
  const last = messages[messages.length - 1];
  const lastIncoming = [...messages].reverse().find((m) => !m.isOutgoing);
  const marvinPrompt = encodeURIComponent(
    `Lies die Konversation „${thread.subject ?? ""}“ (thread_id ${thread.id}) und bereite eine passende Antwort vor.`,
  );

  return (
    <>
      <div className="page-title">
        <div style={{ minWidth: 0 }}>
          <Link href="/emails" className="link-more">
            <Icon name="chevronLeft" size={14} /> Zurück zum Posteingang
          </Link>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>{thread.subject || "(ohne Betreff)"}</h1>
          <p>
            {account.emailAddress} · {thread.messageCount} Nachricht{thread.messageCount === 1 ? "" : "en"}
          </p>
        </div>
        <div className="toolbar">
          {last && (
            <Link className="btn" href={`/emails/neu?antwort=${(lastIncoming ?? last).id}`}>
              <Icon name="reply" size={16} /> Antworten
            </Link>
          )}
          {last && (
            <Link className="btn" href={`/emails/neu?weiterleiten=${last.id}`}>
              <Icon name="forward" size={16} /> Weiterleiten
            </Link>
          )}
          <ActionButton className="btn" action={threadActionForm.bind(null, thread.id, "archive")} title="Archivieren">
            <Icon name="archive" size={16} /> Archivieren
          </ActionButton>
          <ActionButton className="btn" action={threadActionForm.bind(null, thread.id, "unread")} title="Als ungelesen markieren">
            <Icon name="eye" size={16} />
          </ActionButton>
          <ActionButton
            className="btn btn-danger"
            action={threadActionForm.bind(null, thread.id, "trash")}
            confirm="Diese Konversation in den Papierkorb verschieben? Sie lässt sich in Gmail wiederherstellen."
            title="In den Papierkorb"
          >
            <Icon name="trash" size={16} />
          </ActionButton>
        </div>
      </div>

      {sp.gesendet && <div className="notice" style={{ marginBottom: 16 }}>Die E-Mail wurde gesendet.</div>}

      <Link href={`/marvin?prompt=${marvinPrompt}`} className="notice" style={{ marginBottom: 16, alignItems: "center" }}>
        <MarvinIcon size={30} />
        <span style={{ flex: 1 }}>
          <b>Marvin:</b> Soll ich diese Konversation zusammenfassen und eine Antwort vorbereiten?
        </span>
        <span className="link-more">
          Antwort entwerfen <Icon name="arrowRight" size={14} />
        </span>
      </Link>

      <section className="card">
        {messages.map((m) => (
          <article key={m.id} className="thread-msg">
            <header>
              <span className="initials">{initialsOf(m.from)}</span>
              <div className="who">
                <b>
                  {displayName(m.from)} {m.isOutgoing && <span className="badge">Du</span>}
                </b>
                <small>
                  {m.from?.email} → {m.to.map((t) => t.name ?? t.email).join(", ")}
                  {m.cc.length ? ` · Cc: ${m.cc.map((t) => t.name ?? t.email).join(", ")}` : ""}
                </small>
              </div>
              <time className="small muted">{m.receivedAt.toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "medium", timeStyle: "short" })}</time>
            </header>
            {m.bodyHtml ? <MailFrame html={m.bodyHtml} allowRemote={sp.bilder === "1"} /> : <div className="mail-text">{m.bodyText ?? m.snippet}</div>}
            {atts.some((a) => a.emailId === m.id) && (
              <div className="attachments">
                {atts
                  .filter((a) => a.emailId === m.id)
                  .map((a) => (
                    <a key={a.id} className="badge" href={`/api/attachments/${a.id}`}>
                      <Icon name="paperclip" size={13} /> {a.filename} · {Math.max(1, Math.round(a.sizeBytes / 1024))} KB
                    </a>
                  ))}
              </div>
            )}
          </article>
        ))}
      </section>
      {messages.some((m) => m.bodyHtml) && sp.bilder !== "1" && (
        <p className="small muted" style={{ marginTop: 10 }}>
          Externe Bilder sind zum Schutz vor Tracking blockiert. <Link href={`/emails/${thread.id}?bilder=1`} className="link-more">Bilder laden</Link>
        </p>
      )}
    </>
  );
}
