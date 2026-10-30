import Link from "next/link";
import { count, desc, eq, gte, ne, sql, sum } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatUsd } from "@/lib/usage";
import { PLAN_LABEL } from "@/lib/admin-labels";

export const metadata = { title: "Admin" };

export default async function AdminOverview() {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [[users], [active], [disabled], [admins], [accounts], [accErrors], [failedJobs], [usage], [newUsers], plans, topUsage] = await Promise.all([
    db.select({ n: count() }).from(schema.users),
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.subscriptionStatus, "active")),
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.status, "disabled")),
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.role, "admin")),
    db.select({ n: count() }).from(schema.connectedAccounts),
    db.select({ n: count() }).from(schema.connectedAccounts).where(ne(schema.connectedAccounts.status, "active")),
    db.select({ n: count() }).from(schema.jobs).where(eq(schema.jobs.status, "failed")),
    db.select({ cost: sum(schema.usageEvents.costMicros), calls: count() }).from(schema.usageEvents).where(gte(schema.usageEvents.createdAt, monthStart)),
    db.select({ n: count() }).from(schema.users).where(gte(schema.users.createdAt, monthStart)),
    db.select({ plan: schema.users.plan, n: count() }).from(schema.users).groupBy(schema.users.plan),
    db
      .select({ id: schema.users.id, email: schema.users.email, cost: sql<number>`sum(${schema.usageEvents.costMicros})::int`, calls: count() })
      .from(schema.usageEvents)
      .innerJoin(schema.users, eq(schema.users.id, schema.usageEvents.userId))
      .where(gte(schema.usageEvents.createdAt, monthStart))
      .groupBy(schema.users.id)
      .orderBy(desc(sql`sum(${schema.usageEvents.costMicros})`))
      .limit(5),
  ]);
  const tiles = [
    { label: "Kunden gesamt", value: users?.n ?? 0, sub: `${newUsers?.n ?? 0} neu in diesem Monat`, href: "/admin/kunden" },
    { label: "Aktive Abos", value: active?.n ?? 0, sub: `${disabled?.n ?? 0} Konten gesperrt`, href: "/admin/kunden?status=active" },
    { label: "Verbundene Postfächer", value: accounts?.n ?? 0, sub: `${accErrors?.n ?? 0} mit Verbindungsproblem`, href: "/admin/system", warn: (accErrors?.n ?? 0) > 0 },
    { label: "KI-Kosten (Monat)", value: formatUsd(Number(usage?.cost ?? 0)), sub: `${usage?.calls ?? 0} Marvin-Aufrufe`, href: "#nutzung" },
    { label: "Fehlgeschlagene Jobs", value: failedJobs?.n ?? 0, sub: "Synchronisation & Hintergrund", href: "/admin/system", warn: (failedJobs?.n ?? 0) > 0 },
    { label: "Admins", value: admins?.n ?? 0, sub: "mit Vollzugriff", href: "/admin/kunden?rolle=admin" },
  ];
  return (
    <div className="stack">
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`stat ${t.warn ? "tone-red" : "tone-green"}`} style={{ minHeight: 0 }}>
            <small>{t.label}</small>
            <strong>{t.value}</strong>
            <small>{t.sub}</small>
          </Link>
        ))}
      </div>
      <div className="split">
        <section className="card card-pad">
          <div className="card-head"><h2>Kunden nach Tarif</h2></div>
          <table className="table">
            <tbody>
              {plans.map((p) => (
                <tr key={p.plan}><td>{PLAN_LABEL[p.plan] ?? p.plan}</td><td style={{ textAlign: "right" }}>{p.n}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card card-pad" id="nutzung">
          <div className="card-head"><h2>Höchste KI-Nutzung (Monat)</h2></div>
          {topUsage.length ? (
            <table className="table">
              <tbody>
                {topUsage.map((u) => (
                  <tr key={u.id}>
                    <td><Link href={`/admin/kunden/${u.id}`}>{u.email}</Link></td>
                    <td className="muted">{u.calls} Aufrufe</td>
                    <td style={{ textAlign: "right" }}>{formatUsd(u.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">Noch keine Nutzung in diesem Monat.</p>
          )}
          <p className="small muted">Kosten sind Schätzwerte nach Listenpreis; maßgeblich ist die Rechnung von Anthropic.</p>
        </section>
      </div>
    </div>
  );
}
