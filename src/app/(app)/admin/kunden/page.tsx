import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PLAN_LABEL, SUB_LABEL } from "@/lib/admin-labels";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Kunden · Admin" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; rolle?: string; geloescht?: string }> }) {
  const sp = await searchParams;
  const conds: SQL[] = [];
  if (sp.q) conds.push(or(ilike(schema.users.email, `%${sp.q}%`), ilike(schema.users.name, `%${sp.q}%`))!);
  if (sp.status === "active") conds.push(eq(schema.users.subscriptionStatus, "active"));
  if (sp.status === "disabled") conds.push(eq(schema.users.status, "disabled"));
  if (sp.rolle === "admin") conds.push(eq(schema.users.role, "admin"));
  const rows = await db
    .select({
      user: schema.users,
      accounts: sql<number>`(select count(*)::int from ${schema.connectedAccounts} a where a.user_id = "users"."id")`,
      accountIssues: sql<number>`(select count(*)::int from ${schema.connectedAccounts} a where a.user_id = "users"."id" and a.status <> 'active')`,
    })
    .from(schema.users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.users.createdAt))
    .limit(200);
  return (
    <section className="card">
      <div className="card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", paddingBottom: 6 }}>
        <form action="/admin/kunden" style={{ display: "flex", gap: 8, flex: 1, minWidth: 240 }}>
          <input className="input" name="q" defaultValue={sp.q} placeholder="Name oder E-Mail suchen" />
          <select className="select" name="status" defaultValue={sp.status ?? ""} style={{ width: 160 }}>
            <option value="">Alle</option>
            <option value="active">Aktive Abos</option>
            <option value="disabled">Gesperrt</option>
          </select>
          <button className="btn">Filtern</button>
        </form>
        <Link href="/admin/kunden/neu" className="btn btn-primary"><Icon name="plus" size={16} /> Kunde anlegen</Link>
      </div>
      {sp.geloescht && <div className="notice" style={{ margin: "0 22px 12px" }}>Der Kunde wurde mit allen Daten gelöscht.</div>}
      <table className="table">
        <thead>
          <tr><th>Kunde</th><th>Tarif</th><th>Abo</th><th>Postfächer</th><th>Letzte Anmeldung</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map(({ user: u, accounts, accountIssues }) => (
            <tr key={u.id}>
              <td>
                <Link href={`/admin/kunden/${u.id}`}><b>{u.name ?? u.email}</b></Link>
                <div className="small muted">{u.email}{u.role === "admin" ? " · Admin" : ""}</div>
              </td>
              <td>{PLAN_LABEL[u.plan]}</td>
              <td><span className={`badge ${u.subscriptionStatus === "active" ? "badge-green" : u.subscriptionStatus === "past_due" ? "badge-red" : ""}`}>{SUB_LABEL[u.subscriptionStatus]}</span></td>
              <td>{accounts}{accountIssues > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{accountIssues} Problem</span>}</td>
              <td className="small muted">{u.lastLoginAt?.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "nie"}</td>
              <td>
                {u.status === "disabled" ? <span className="badge badge-red">Gesperrt</span> : u.lockedUntil && u.lockedUntil > new Date() ? <span className="badge badge-amber">Vorübergehend gesperrt</span> : <span className="badge badge-green">Aktiv</span>}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="muted">Keine Kunden gefunden.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
