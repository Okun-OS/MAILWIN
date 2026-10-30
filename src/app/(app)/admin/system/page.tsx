import Link from "next/link";
import { count, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { integrations } from "@/lib/env";
import { channels } from "@/lib/notify";
import { ActionButton } from "@/components/ConfirmButton";
import { resyncAccountAction, retryJobAction } from "../actions";

export const metadata = { title: "System · Admin" };

export default async function SystemPage() {
  const [failed, queue, problems] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.status, "failed")).orderBy(desc(schema.jobs.createdAt)).limit(50),
    db.select({ status: schema.jobs.status, n: count() }).from(schema.jobs).groupBy(schema.jobs.status),
    db
      .select({ a: schema.connectedAccounts, email: schema.users.email })
      .from(schema.connectedAccounts)
      .innerJoin(schema.users, eq(schema.users.id, schema.connectedAccounts.userId))
      .where(ne(schema.connectedAccounts.status, "active")),
  ]);
  const services = [
    { name: "Google (Anmeldung, Gmail, Kalender)", ok: integrations.google },
    { name: "Microsoft 365 / Outlook", ok: integrations.microsoft },
    { name: "Marvin (Claude API)", ok: integrations.marvin },
    { name: "E-Mail-Versand (Resend)", ok: channels.email },
    { name: "SMS-Versand (Twilio)", ok: channels.sms },
  ];
  return (
    <div className="stack">
      <div className="split">
        <section className="card card-pad">
          <div className="card-head"><h2>Dienste</h2></div>
          <table className="table"><tbody>
            {services.map((s) => (
              <tr key={s.name}><td>{s.name}</td><td style={{ textAlign: "right" }}><span className={`badge ${s.ok ? "badge-green" : "badge-amber"}`}>{s.ok ? "eingerichtet" : "nicht eingerichtet"}</span></td></tr>
            ))}
          </tbody></table>
        </section>
        <section className="card card-pad">
          <div className="card-head"><h2>Warteschlange</h2></div>
          <table className="table"><tbody>
            {queue.map((q) => <tr key={q.status}><td>{q.status}</td><td style={{ textAlign: "right" }}>{q.n}</td></tr>)}
            {!queue.length && <tr><td className="muted">leer</td></tr>}
          </tbody></table>
        </section>
      </div>
      <section className="card card-pad">
        <div className="card-head"><h2>Postfächer mit Problemen</h2></div>
        <table className="table"><tbody>
          {problems.map(({ a, email }) => (
            <tr key={a.id}>
              <td><b>{a.emailAddress}</b><div className="small muted">Kunde: <Link href={`/admin/kunden/${a.userId}`}>{email}</Link></div></td>
              <td><span className="badge badge-red">{a.status}</span><div className="small muted">{a.lastError}</div></td>
              <td style={{ textAlign: "right" }}><ActionButton action={resyncAccountAction.bind(null, a.id)}>Erneut versuchen</ActionButton></td>
            </tr>
          ))}
          {!problems.length && <tr><td className="muted">Alle Postfächer verbunden.</td></tr>}
        </tbody></table>
      </section>
      <section className="card card-pad">
        <div className="card-head"><h2>Fehlgeschlagene Jobs</h2></div>
        <table className="table"><tbody>
          {failed.map((j) => (
            <tr key={j.id}>
              <td className="small">{j.kind}<div className="muted">{j.createdAt.toLocaleString("de-DE")}</div></td>
              <td className="small muted" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{j.lastError}</td>
              <td style={{ textAlign: "right" }}><ActionButton action={retryJobAction.bind(null, j.id)}>Wiederholen</ActionButton></td>
            </tr>
          ))}
          {!failed.length && <tr><td className="muted">Keine.</td></tr>}
        </tbody></table>
      </section>
    </div>
  );
}
