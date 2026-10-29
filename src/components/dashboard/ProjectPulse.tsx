import Link from "next/link";
import { Icon } from "../Icon";

const STATUS: Record<string, string> = { planning: "In Planung", active: "Aktiv", waiting: "Wartet auf Rückmeldung" };
const TONES = [
  { bg: "var(--mw-mint-100)", fg: "var(--mw-green-600)" },
  { bg: "var(--mw-amber-50)", fg: "var(--mw-amber-500)" },
  { bg: "var(--mw-blue-50)", fg: "var(--mw-blue-500)" },
];

export function ProjectPulse({ projects }: { projects: { id: string; name: string; description: string | null; status: string; progress: number; total: number }[] }) {
  return (
    <section className="card card-pad" aria-label="Projekt-Pulse">
      <div className="card-head">
        <span className="head-icon">
          <Icon name="folder" />
        </span>
        <div>
          <h2>Projekt-Pulse</h2>
          <p>Aktive Projekte und aktueller Status</p>
        </div>
        <div className="end">
          <Link href="/projekte" className="link-more">
            Alle Projekte <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </div>
      {projects.length ? (
        projects.map((p, i) => (
          <Link key={p.id} href={`/projekte/${p.id}`} className="project-row">
            <span className="head-icon" style={{ background: TONES[i % 3]!.bg, color: TONES[i % 3]!.fg }}>
              <Icon name="folder" size={17} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{p.name}</b>
              <small>{p.description ?? STATUS[p.status] ?? p.status}</small>
            </span>
            <span className="progress" aria-label={`${p.progress} % erledigt`}>
              <i style={{ width: `${p.progress}%` }} />
            </span>
            <span className="small muted" style={{ textAlign: "right" }}>
              {p.total ? `${p.progress} %` : "–"}
            </span>
            <span className="chev">
              <Icon name="chevronRight" size={14} />
            </span>
          </Link>
        ))
      ) : (
        <div className="empty">
          <b>Noch keine Projekte</b>
          Starte ein Projekt mit Marvin – er plant die Schritte und kümmert sich um die Kommunikation.
          <Link href="/projekte/neu" className="btn btn-sm" style={{ marginTop: 6 }}>
            <Icon name="plus" size={14} /> Projekt starten
          </Link>
        </div>
      )}
    </section>
  );
}
