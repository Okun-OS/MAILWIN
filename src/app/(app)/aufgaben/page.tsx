import Link from "next/link";
import { and, eq, ne, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { TaskList } from "@/components/TaskList";
import { Icon } from "@/components/Icon";
import { createTaskAction } from "../actions";

export const metadata = { title: "Aufgaben" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ erledigt?: string }> }) {
  const user = await requireUser();
  const showDone = (await searchParams).erledigt === "1";
  const tasks = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
      priority: schema.tasks.priority,
      dueAt: schema.tasks.dueAt,
      threadId: schema.tasks.threadId,
      projectId: schema.tasks.projectId,
      projectName: schema.projects.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(and(eq(schema.tasks.userId, user.id), showDone ? eq(schema.tasks.status, "done") : ne(schema.tasks.status, "done")))
    .orderBy(sql`${schema.tasks.dueAt} asc nulls last`, schema.tasks.createdAt)
    .limit(200);
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Aufgaben</h1>
          <p>Projektübergreifend – mit Fristen, Prioritäten und Status.</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <Link href="/aufgaben" className={!showDone ? "active" : undefined}>Offen</Link>
          <Link href="/aufgaben?erledigt=1" className={showDone ? "active" : undefined}>Erledigt</Link>
        </div>
      </div>
      <form action={createTaskAction} className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <input className="input" name="title" placeholder="Neue Aufgabe …" required style={{ flex: "1 1 260px" }} />
        <input className="input" type="date" name="dueAt" style={{ width: 170 }} aria-label="Fällig am" />
        <select className="select" name="priority" style={{ width: 150 }} aria-label="Priorität" defaultValue="normal">
          <option value="urgent">Dringend</option>
          <option value="important">Wichtig</option>
          <option value="normal">Normal</option>
          <option value="low">Niedrig</option>
        </select>
        <button className="btn btn-primary"><Icon name="plus" size={16} /> Hinzufügen</button>
      </form>
      <section className="card">
        <TaskList tasks={tasks} timezone={user.timezone} />
      </section>
    </>
  );
}
