import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AdminForm } from "@/components/admin/AdminForms";
import { ActionButton } from "@/components/ConfirmButton";
import { createAnnouncementAction, toggleAnnouncementAction } from "../actions";

export const metadata = { title: "Systemmeldungen · Admin" };

export default async function AnnouncementsPage() {
  const rows = await db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt));
  return (
    <div className="split" style={{ alignItems: "start", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)" }}>
      <section className="card card-pad">
        <div className="card-head"><h2>Meldung an alle Kunden</h2></div>
        <AdminForm action={createAnnouncementAction} submit="Veröffentlichen">
          <div className="field"><label>Titel</label><input className="input" name="title" required placeholder="z. B. Wartung am Sonntag, 8–9 Uhr" /></div>
          <div className="field"><label>Text</label><textarea className="textarea" name="body" style={{ minHeight: 80 }} /></div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field">
              <label>Art</label>
              <select className="select" name="level" defaultValue="info"><option value="info">Information</option><option value="warning">Warnung</option></select>
            </div>
            <div className="field"><label>Anzeigen bis</label><input className="input" type="date" name="endsAt" /></div>
          </div>
        </AdminForm>
      </section>
      <section className="card">
        <table className="table">
          <thead><tr><th>Meldung</th><th>Bis</th><th /></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><b>{a.title}</b>{a.body && <div className="small muted">{a.body}</div>}</td>
                <td className="small">{a.endsAt?.toLocaleDateString("de-DE") ?? "offen"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className={`badge ${a.level === "warning" ? "badge-amber" : "badge-blue"}`}>{a.level === "warning" ? "Warnung" : "Info"}</span>{" "}
                  <ActionButton action={toggleAnnouncementAction.bind(null, a.id, !a.active)}>{a.active ? "Ausblenden" : "Einblenden"}</ActionButton>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={3} className="muted">Keine Meldungen.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
