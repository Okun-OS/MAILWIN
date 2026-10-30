import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata = { title: "Aktivitäten" };

const ACTOR: Record<string, string> = { user: "Du", marvin: "Marvin", automation: "Automation", system: "System" };
const ACTION: Record<string, string> = {
  send_email: "E-Mail gesendet",
  forward_email: "E-Mail weitergeleitet",
  thread_archive: "Archiviert",
  thread_trash: "In den Papierkorb verschoben",
  thread_read: "Als gelesen markiert",
  thread_unread: "Als ungelesen markiert",
  thread_labels: "Labels geändert",
  create_label: "Label angelegt",
  create_task: "Aufgabe angelegt",
  create_project: "Projekt angelegt",
  connect_account: "Konto verbunden",
  disconnect_account: "Konto getrennt",
  set_permission_level: "Freigabestufe geändert",
  approve_send_email: "Versand freigegeben",
  reject_send_email: "Versand abgelehnt",
  approve_trash_thread: "Papierkorb bestätigt",
  reject_trash_thread: "Papierkorb abgelehnt",
  crm_create_lead: "Lead im CRM angelegt",
  crm_link_thread: "Konversation im CRM zugeordnet",
  crm_unlink_thread: "CRM-Zuordnung gelöst",
  approve_crm_create_lead: "Lead freigegeben",
  reject_crm_create_lead: "Lead abgelehnt",
  sync: "Synchronisation",
};

/** Nachvollziehbare Aktionshistorie (Spezifikation 14, Abnahmetest 10). */
export default async function ActivityPage() {
  const user = await requireUser();
  const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, user.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(200);
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Aktivitäten</h1>
          <p>Alles, was du, Marvin oder Automationen ausgeführt haben – auch verweigerte und fehlgeschlagene Aktionen.</p>
        </div>
      </div>
      <section className="card">
        {logs.length ? (
          <table className="table">
            <thead><tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" style={{ whiteSpace: "nowrap" }}>{l.createdAt.toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "short", timeStyle: "medium" })}</td>
                  <td>{ACTOR[l.actor] ?? l.actor}</td>
                  <td>{ACTION[l.action] ?? l.action}</td>
                  <td><span className={`badge ${l.status === "success" ? "badge-green" : "badge-red"}`}>{{ success: "Erfolgreich", failed: "Fehlgeschlagen", denied: "Verweigert" }[l.status]}</span></td>
                  <td className="small muted" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>
                    {typeof l.details.subject === "string" && <>„{l.details.subject}“ </>}
                    {Array.isArray(l.details.to) && <>an {(l.details.to as string[]).join(", ")} </>}
                    {typeof l.details.error === "string" && <>{l.details.error}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty"><b>Noch keine Aktivitäten</b></div>
        )}
      </section>
    </>
  );
}
