import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AdminForm } from "@/components/admin/AdminForms";
import { ActionButton } from "@/components/ConfirmButton";
import { createCampaignAction, toggleCampaignAction } from "../actions";

export const metadata = { title: "Aktionen · Admin" };

export default async function CampaignsPage() {
  const rows = await db
    .select({
      c: schema.campaigns,
      vouchers: sql<number>`(select count(*)::int from ${schema.vouchers} v where v.campaign_id = "campaigns"."id")`,
      redeemed: sql<number>`(select coalesce(sum(v.redeemed_count),0)::int from ${schema.vouchers} v where v.campaign_id = "campaigns"."id")`,
    })
    .from(schema.campaigns)
    .orderBy(desc(schema.campaigns.createdAt));
  const now = new Date();
  return (
    <div className="split" style={{ alignItems: "start", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)" }}>
      <section className="card card-pad">
        <div className="card-head"><h2>Aktion starten</h2></div>
        <AdminForm action={createCampaignAction} submit="Aktion anlegen">
          <div className="field"><label>Name</label><input className="input" name="name" required placeholder="z. B. Launch-Angebot" /></div>
          <div className="field"><label>Beschreibung (intern)</label><textarea className="textarea" name="description" style={{ minHeight: 70 }} /></div>
          <div className="field"><label>Bannertext für die Website</label><input className="input" name="bannerText" placeholder="z. B. Nur bis Sonntag: 3 Monate gratis mit LAUNCH26" /></div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field"><label>Start</label><input className="input" type="date" name="startsAt" /></div>
            <div className="field"><label>Ende</label><input className="input" type="date" name="endsAt" /></div>
          </div>
          <p className="small muted">Gutscheine ordnest du beim Anlegen einer Aktion zu. Der Bannertext erscheint auf der Website, sobald sie online ist.</p>
        </AdminForm>
      </section>
      <section className="card">
        <table className="table">
          <thead><tr><th>Aktion</th><th>Zeitraum</th><th>Gutscheine</th><th /></tr></thead>
          <tbody>
            {rows.map(({ c, vouchers, redeemed }) => {
              const running = c.active && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now);
              return (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.bannerText && <div className="small muted">„{c.bannerText}“</div>}</td>
                  <td className="small">{c.startsAt?.toLocaleDateString("de-DE") ?? "sofort"} – {c.endsAt?.toLocaleDateString("de-DE") ?? "offen"}</td>
                  <td>{vouchers} ({redeemed} eingelöst)</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span className={`badge ${running ? "badge-green" : ""}`}>{running ? "läuft" : c.active ? "geplant/beendet" : "gestoppt"}</span>{" "}
                    <ActionButton action={toggleCampaignAction.bind(null, c.id, !c.active)}>{c.active ? "Stoppen" : "Aktivieren"}</ActionButton>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={4} className="muted">Noch keine Aktionen.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
