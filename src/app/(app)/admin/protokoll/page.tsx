import Link from "next/link";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const metadata = { title: "Protokoll · Admin" };

export default async function AdminLogPage({ searchParams }: { searchParams: Promise<{ wer?: string; q?: string }> }) {
  const sp = await searchParams;
  const conds: SQL[] = [];
  if (sp.wer) conds.push(eq(schema.auditLogs.actor, sp.wer as "admin"));
  if (sp.q) conds.push(or(ilike(schema.auditLogs.action, `%${sp.q}%`), ilike(schema.users.email, `%${sp.q}%`))!);
  const rows = await db
    .select({ l: schema.auditLogs, email: schema.users.email })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(300);
  return (
    <section className="card">
      <form action="/admin/protokoll" className="card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" name="q" defaultValue={sp.q} placeholder="Aktion oder E-Mail" style={{ maxWidth: 280 }} />
        <select className="select" name="wer" defaultValue={sp.wer ?? ""} style={{ width: 180 }}>
          <option value="">Alle</option><option value="admin">Admins</option><option value="user">Kunden</option><option value="marvin">Marvin</option><option value="system">System</option>
        </select>
        <button className="btn">Filtern</button>
      </form>
      <table className="table">
        <thead><tr><th>Zeit</th><th>Kunde</th><th>Wer</th><th>Aktion</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map(({ l, email }) => (
            <tr key={l.id}>
              <td className="small muted" style={{ whiteSpace: "nowrap" }}>{l.createdAt.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}</td>
              <td className="small">{email ? <Link href={`/admin/kunden/${l.userId}`}>{email}</Link> : "–"}</td>
              <td className="small">{l.actor}</td>
              <td className="small">{l.action}</td>
              <td><span className={`badge ${l.status === "success" ? "badge-green" : "badge-red"}`}>{l.status}</span></td>
              <td className="small muted" style={{ maxWidth: 320, overflowWrap: "anywhere" }}>{Object.keys(l.details).length ? JSON.stringify(l.details) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
