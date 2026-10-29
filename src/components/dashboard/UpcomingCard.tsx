import Link from "next/link";
import { Icon } from "../Icon";

export function UpcomingCard({ items }: { items: { id: string; title: string; sub: string; time: string; now: boolean }[] }) {
  return (
    <section className="card card-pad" aria-label="Nächste Termine">
      <div className="card-head">
        <span className="head-icon">
          <Icon name="calendar" />
        </span>
        <h2>Nächste Termine</h2>
        <div className="end">
          <Link href="/kalender" className="link-more">
            Kalender <Icon name="chevronRight" size={14} />
          </Link>
        </div>
      </div>
      {items.length ? (
        <div className="timeline">
          {items.map((e) => (
            <div key={e.id} className="tl-item">
              <span className="dot" />
              <time>{e.time}</time>
              <div style={{ minWidth: 0 }}>
                <b>{e.title}</b>
                {e.sub && <small>{e.sub}</small>}
              </div>
              {e.now ? <span className="badge badge-green">Jetzt</span> : <span />}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>Keine anstehenden Termine</b>
          Termine aus deinem verbundenen Kalender erscheinen hier.
        </div>
      )}
    </section>
  );
}
