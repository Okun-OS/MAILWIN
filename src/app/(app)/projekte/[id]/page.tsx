import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { loadMessages } from "@/lib/marvin/history";
import { toChatItems } from "@/lib/marvin/view";
import { listAccounts } from "@/lib/mail/accounts";
import { TaskList } from "@/components/TaskList";
import { MarvinThread } from "@/components/MarvinThread";
import { MarvinComposer } from "@/components/MarvinComposer";
import { MarvinIcon } from "@/components/Marvin";
import { ActionButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import { createTaskAction, updateProjectStatusAction } from "../../actions";

export const maxDuration = 300;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) notFound();

  const [tasks, [conversation], accounts] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.projectId, id)).orderBy(sql`${schema.tasks.status} = 'done'`, asc(schema.tasks.sortOrder), asc(schema.tasks.createdAt)),
    db.select().from(schema.marvinConversations).where(eq(schema.marvinConversations.projectId, id)).orderBy(asc(schema.marvinConversations.createdAt)).limit(1),
    listAccounts(user.id),
  ]);
  const items = conversation ? await toChatItems(await loadMessages(conversation.id)) : [];
  const done = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <>
      <div className="page-title">
        <div style={{ minWidth: 0 }}>
          <Link href="/projekte" className="link-more"><Icon name="chevronLeft" size={14} /> Projekte</Link>
          <h1 style={{ marginTop: 6 }}>{project.name}</h1>
          <p>{project.description ?? project.goal}</p>
        </div>
        <div className="toolbar">
          {project.status !== "done" ? (
            <ActionButton className="btn" action={updateProjectStatusAction.bind(null, project.id, "done")} confirm="Projekt als abgeschlossen markieren?">
              <Icon name="check" size={16} /> Abschließen
            </ActionButton>
          ) : (
            <ActionButton className="btn" action={updateProjectStatusAction.bind(null, project.id, "active")}>Wieder öffnen</ActionButton>
          )}
        </div>
      </div>
      <div className="split" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className="card card-pad">
            <div className="card-head">
              <span className="head-icon"><Icon name="checkSquare" /></span>
              <div>
                <h2>Projektplan</h2>
                <p>{tasks.length ? `${done} von ${tasks.length} Schritten erledigt` : "Noch keine Schritte – Marvin legt sie im Gespräch an."}</p>
              </div>
              <span className="end small muted">{progress} %</span>
            </div>
            <div className="progress" style={{ marginBottom: 12 }}><i style={{ width: `${progress}%` }} /></div>
            <TaskList tasks={tasks} timezone={user.timezone} />
            <form action={createTaskAction} style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input type="hidden" name="projectId" value={project.id} />
              <input className="input" name="title" placeholder="Schritt hinzufügen …" required />
              <button className="btn"><Icon name="plus" size={16} /></button>
            </form>
          </section>
          {project.goal && (
            <section className="card card-pad">
              <div className="card-head"><h2>Ziel</h2></div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{project.goal}</p>
            </section>
          )}
        </div>
        <section className="card chat" style={{ minHeight: 640 }}>
          <div className="card-head" style={{ padding: "16px 20px 0" }}>
            <MarvinIcon size={36} />
            <div>
              <h2>Marvin im Projekt</h2>
              <p>Frag nach dem Stand, lass Rückfragen schreiben oder Ansprechpartner recherchieren.</p>
            </div>
          </div>
          <div className="chat-scroll bottom" style={{ maxHeight: 720 }}>
            <div className="chat-items">
              <MarvinThread items={items} accountEmails={Object.fromEntries(accounts.map((a) => [a.id, a.emailAddress]))} />
            </div>
          </div>
          <MarvinComposer conversationId={conversation?.id} projectId={project.id} placeholder="„Marvin, wie weit sind wir?“" />
        </section>
      </div>
    </>
  );
}
