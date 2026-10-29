import Link from "next/link";
import { toggleTaskAction } from "@/app/(app)/actions";
import { ActionButton } from "./ConfirmButton";
import { Icon } from "./Icon";

export const TASK_STATUS: Record<string, string> = {
  open: "Offen",
  researching: "In Recherche",
  draft_ready: "Entwurf vorbereitet",
  awaiting_approval: "Wartet auf Freigabe",
  sent: "E-Mail versendet",
  awaiting_reply: "Wartet auf Antwort",
  reply_received: "Antwort eingegangen",
  action_required: "Aktion erforderlich",
  done: "Erledigt",
  blocked: "Blockiert",
};
const PRIO: Record<string, string> = { urgent: "badge-red", important: "badge-amber", normal: "", low: "" };
const PRIO_LABEL: Record<string, string> = { urgent: "Dringend", important: "Wichtig", normal: "", low: "Niedrig" };

type Task = { id: string; title: string; status: string; priority: string; dueAt: Date | null; threadId: string | null; projectName?: string | null; projectId?: string | null };

export function TaskList({ tasks, timezone }: { tasks: Task[]; timezone: string }) {
  if (!tasks.length) return <div className="empty"><b>Keine Aufgaben</b>Neue Aufgaben legst du oben an – oder Marvin erstellt sie aus E-Mails und Projekten.</div>;
  return (
    <div className="list">
      {tasks.map((t) => {
        const overdue = t.dueAt && t.status !== "done" && t.dueAt.getTime() < Date.now();
        return (
          <div key={t.id} className="list-row" style={{ gridTemplateColumns: "28px minmax(0,1fr) auto" }}>
            <ActionButton action={toggleTaskAction.bind(null, t.id)} className={`check${t.status === "done" ? " done" : ""}`} title={t.status === "done" ? "Wieder öffnen" : "Erledigen"}>
              {t.status === "done" && <Icon name="check" size={12} strokeWidth={3} />}
            </ActionButton>
            <span style={{ minWidth: 0 }}>
              <div className="subj" style={t.status === "done" ? { textDecoration: "line-through", color: "var(--mw-ink-400)" } : undefined}>{t.title}</div>
              <div className="snip">
                {t.projectName && t.projectId && <Link href={`/projekte/${t.projectId}`}>{t.projectName} · </Link>}
                {t.threadId && <Link href={`/emails/${t.threadId}`}>zur E-Mail · </Link>}
                {TASK_STATUS[t.status] ?? t.status}
              </div>
            </span>
            <span className="meta">
              {t.dueAt && (
                <span className={`badge ${overdue ? "badge-red" : ""}`}>
                  {t.dueAt.toLocaleDateString("de-DE", { timeZone: timezone, day: "numeric", month: "short" })}
                </span>
              )}
              {PRIO_LABEL[t.priority] && <span className={`badge ${PRIO[t.priority]}`}>{PRIO_LABEL[t.priority]}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
