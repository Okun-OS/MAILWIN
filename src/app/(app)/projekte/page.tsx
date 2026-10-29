import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Projekte" };

const STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "In Planung", cls: "badge-violet" },
  active: { label: "Aktiv", cls: "badge-green" },
  waiting: { label: "Wartet", cls: "badge-blue" },
  done: { label: "Abgeschlossen", cls: "" },
  archived: { label: "Archiviert", cls: "" },
};

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await db
    .select({
      project: schema.projects,
      total: sql<number>`count(${schema.tasks.id})::int`,
      done: sql<number>`count(${schema.tasks.id}) filter (where ${schema.tasks.status} = 'done')::int`,
    })
    .from(schema.projects)
    .leftJoin(schema.tasks, eq(schema.tasks.projectId, schema.projects.id))
    .where(eq(schema.projects.userId, user.id))
    .groupBy(schema.projects.id)
    .orderBy(desc(schema.projects.updatedAt));
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Projekte</h1>
          <p>Kommunikation, Aufgaben und Entscheidungen zu einem Ziel – begleitet von Marvin.</p>
        </div>
        <Link href="/projekte/neu" className="btn btn-primary">
          <Icon name="plus" size={16} /> Neues Projekt mit Marvin
        </Link>
      </div>
      <section className="card card-pad">
        {projects.length ? (
          projects.map(({ project: p, total, done }) => {
            const progress = total ? Math.round((done / total) * 100) : 0;
            const st = STATUS[p.status] ?? STATUS.planning!;
            return (
              <Link key={p.id} href={`/projekte/${p.id}`} className="project-row">
                <span className="head-icon"><Icon name="folder" size={17} /></span>
                <span style={{ minWidth: 0 }}>
                  <b>{p.name}</b>
                  <small>{p.description ?? p.goal ?? ""}</small>
                </span>
                <span className="progress"><i style={{ width: `${progress}%` }} /></span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
                <span className="chev"><Icon name="chevronRight" size={14} /></span>
              </Link>
            );
          })
        ) : (
          <div className="empty">
            <b>Noch keine Projekte</b>
            Beschreibe Marvin ein Ziel – er plant mit dir die Schritte und übernimmt die E-Mail-Arbeit.
          </div>
        )}
      </section>
    </>
  );
}
