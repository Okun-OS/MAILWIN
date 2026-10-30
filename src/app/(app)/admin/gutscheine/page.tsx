import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AdminForm } from "@/components/admin/AdminForms";
import { ActionButton } from "@/components/ConfirmButton";
import { createVoucherAction, toggleVoucherAction } from "../actions";

export const metadata = { title: "Gutscheine · Admin" };

const valueLabel = (v: { kind: string; value: number }) =>
  v.kind === "percent" ? `${v.value} % Rabatt` : v.kind === "fixed" ? `${(v.value / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} Rabatt` : `${v.value} Gratismonat${v.value === 1 ? "" : "e"}`;

export default async function VouchersPage() {
  const [vouchers, campaigns] = await Promise.all([
    db.select({ v: schema.vouchers, campaign: schema.campaigns.name }).from(schema.vouchers).leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.vouchers.campaignId)).orderBy(desc(schema.vouchers.createdAt)),
    db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)),
  ]);
  return (
    <div className="split" style={{ alignItems: "start", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)" }}>
      <section className="card card-pad">
        <div className="card-head"><h2>Gutschein anlegen</h2></div>
        <AdminForm action={createVoucherAction} submit="Gutschein anlegen">
          <div className="field"><label>Code</label><input className="input" name="code" placeholder="leer lassen = generieren, z. B. WINTER26" style={{ textTransform: "uppercase" }} /></div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field">
              <label>Art</label>
              <select className="select" name="kind" defaultValue="percent">
                <option value="percent">Prozent-Rabatt</option>
                <option value="fixed">Fester Betrag (€)</option>
                <option value="free_months">Gratismonate</option>
              </select>
            </div>
            <div className="field"><label>Wert</label><input className="input" name="value" inputMode="decimal" required placeholder="z. B. 20" /></div>
          </div>
          <div className="field"><label>Beschreibung (intern)</label><input className="input" name="description" /></div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field"><label>Gültig ab</label><input className="input" type="date" name="validFrom" /></div>
            <div className="field"><label>Gültig bis</label><input className="input" type="date" name="validUntil" /></div>
          </div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field"><label>Max. Einlösungen</label><input className="input" name="maxRedemptions" type="number" min={0} placeholder="unbegrenzt" /></div>
            <div className="field">
              <label>Aktion</label>
              <select className="select" name="campaignId" defaultValue="">
                <option value="">– keine –</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <p className="small muted">Eingelöst werden Gutscheine beim Kauf – das wird mit der Stripe-Anbindung aktiv.</p>
        </AdminForm>
      </section>
      <section className="card">
        <table className="table">
          <thead><tr><th>Code</th><th>Vorteil</th><th>Gültigkeit</th><th>Einlösungen</th><th /></tr></thead>
          <tbody>
            {vouchers.map(({ v, campaign }) => {
              const expired = v.validUntil && v.validUntil < new Date();
              return (
                <tr key={v.id}>
                  <td><code style={{ fontWeight: 700 }}>{v.code}</code><div className="small muted">{[v.description, campaign].filter(Boolean).join(" · ")}</div></td>
                  <td>{valueLabel(v)}</td>
                  <td className="small">{v.validFrom ? `ab ${v.validFrom.toLocaleDateString("de-DE")} ` : ""}{v.validUntil ? `bis ${v.validUntil.toLocaleDateString("de-DE")}` : "unbefristet"}</td>
                  <td>{v.redeemedCount}{v.maxRedemptions ? ` / ${v.maxRedemptions}` : ""}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {expired ? <span className="badge">abgelaufen</span> : <span className={`badge ${v.active ? "badge-green" : ""}`}>{v.active ? "aktiv" : "pausiert"}</span>}{" "}
                    <ActionButton action={toggleVoucherAction.bind(null, v.id, !v.active)}>{v.active ? "Pausieren" : "Aktivieren"}</ActionButton>
                  </td>
                </tr>
              );
            })}
            {!vouchers.length && <tr><td colSpan={5} className="muted">Noch keine Gutscheine.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
