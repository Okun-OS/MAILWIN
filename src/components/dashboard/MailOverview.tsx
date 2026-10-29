import Link from "next/link";
import { Icon, type IconName } from "../Icon";

export function MailOverview({ mail }: { mail: { important: number; awaiting: number; newToday: number; autoSorted: number } }) {
  const tiles: { tone: string; icon: IconName; value: number; title: string; sub: string; href: string }[] = [
    { tone: "tone-red", icon: "mail", value: mail.important, title: "Wichtig", sub: "Antwort erforderlich", href: "/emails?filter=antworten" },
    { tone: "tone-blue", icon: "chat", value: mail.awaiting, title: "Warten auf Antwort", sub: "Seit über 3 Tagen", href: "/emails?filter=wartend" },
    { tone: "tone-green", icon: "inbox", value: mail.newToday, title: "Neu eingegangen", sub: "Heute", href: "/emails?filter=heute" },
    { tone: "tone-violet", icon: "sparkle", value: mail.autoSorted, title: "Automatisch sortiert", sub: "Heute durch Regeln", href: "/aktivitaeten" },
  ];
  return (
    <section className="card card-pad" aria-label="Mail-Übersicht">
      <div className="card-head">
        <span className="head-icon" style={{ background: "var(--mw-violet-50)", color: "var(--mw-violet-500)" }}>
          <Icon name="mail" />
        </span>
        <div>
          <h2>Mail-Übersicht</h2>
          <p>Relevanz vor Masse – sortiert von Marvin</p>
        </div>
        <div className="end">
          <Link href="/emails" className="link-more">
            Alle E-Mails <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </div>
      <div className="stat-grid">
        {tiles.map((t) => (
          <Link key={t.title} href={t.href} className={`stat ${t.tone}`}>
            <span className="si">
              <Icon name={t.icon} size={17} />
            </span>
            <strong>{t.value}</strong>
            <b>{t.title}</b>
            <small>{t.sub}</small>
            <span className="arrow">
              <Icon name="chevronRight" size={15} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
