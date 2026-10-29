import { and, desc, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { listAccounts } from "@/lib/mail/accounts";
import { ApprovalCard } from "@/components/ApprovalCard";

export const metadata = { title: "Freigaben" };

const DECIDED: Record<string, string> = { executed: "Ausgeführt", rejected: "Abgelehnt", failed: "Fehlgeschlagen", approved: "Freigegeben", expired: "Abgelaufen" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  const [pending, recent, accounts] = await Promise.all([
    db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.userId, user.id), eq(schema.approvalRequests.status, "pending"))).orderBy(desc(schema.approvalRequests.createdAt)),
    db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.userId, user.id), ne(schema.approvalRequests.status, "pending"))).orderBy(desc(schema.approvalRequests.createdAt)).limit(15),
    listAccounts(user.id),
  ]);
  const emails = Object.fromEntries(accounts.map((a) => [a.id, a.emailAddress]));
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Freigaben</h1>
          <p>Marvin sendet nichts ohne dich. Prüfe, bearbeite und gib frei – oder lehne ab.</p>
        </div>
      </div>
      <div className="stack">
        {pending.length ? (
          pending.map((a) => <ApprovalCard key={a.id} approval={a} accountEmail={a.accountId ? emails[a.accountId] : undefined} />)
        ) : (
          <div className="card empty">
            <b>Keine offenen Freigaben</b>
            Wenn Marvin einen Entwurf vorbereitet, erscheint er hier und im Chat.
          </div>
        )}
        {recent.length > 0 && (
          <section className="card card-pad">
            <div className="card-head">
              <h2>Zuletzt entschieden</h2>
            </div>
            <table className="table">
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <td>{a.summary}</td>
                    <td>
                      <span className={`badge ${a.status === "executed" ? "badge-green" : a.status === "failed" ? "badge-red" : ""}`}>
                        {DECIDED[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="muted small">{(a.decidedAt ?? a.createdAt).toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "short", timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
