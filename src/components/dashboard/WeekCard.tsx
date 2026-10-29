import Link from "next/link";
import { Icon } from "../Icon";
import type { WeekDay } from "@/lib/dashboard/data";

const DOT = { event: "var(--mw-blue-500)", task: "var(--mw-violet-500)", mail: "var(--mw-red-500)" } as const;

export function WeekCard({ week, offset, timezone, calendarConnected }: { week: WeekDay[]; offset: number; timezone: string; calendarConnected: boolean }) {
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("de-DE", { timeZone: timezone, ...o });
  const empty = week.every((d) => !d.items.length);
  return (
    <section className="card card-pad" aria-label="Deine Woche">
      <div className="card-head">
        <span className="head-icon">
          <Icon name="clock" />
        </span>
        <div>
          <h2>Deine Woche</h2>
          <p>Termine, wichtige E-Mails und fällige Aufgaben auf einen Blick</p>
        </div>
        <div className="end">
          <Link className="icon-btn" href={`/?woche=${offset - 1}`} aria-label="Vorherige Woche">
            <Icon name="chevronLeft" size={16} />
          </Link>
          <Link className="btn btn-sm" href="/">
            {offset === 0 ? "Diese Woche" : `${fmt(week[0]!.date, { day: "numeric", month: "short" })} – ${fmt(week[4]!.date, { day: "numeric", month: "short" })}`}
          </Link>
          <Link className="icon-btn" href={`/?woche=${offset + 1}`} aria-label="Nächste Woche">
            <Icon name="chevronRight" size={16} />
          </Link>
        </div>
      </div>
      <div className="week">
        {week.map((d) => (
          <div key={d.date.toISOString()} className={`week-day${d.isToday ? " today" : ""}`}>
            <header>
              <b>{d.isToday ? "Heute" : fmt(d.date, { weekday: "short" }).replace(".", "")}</b>
              <small>{fmt(d.date, { day: "numeric", month: "short" })}</small>
            </header>
            {d.items.slice(0, 4).map((it, i) => (
              <div key={i} className="week-item">
                <i style={{ background: DOT[it.kind] }} />
                <span>{it.label}</span>
              </div>
            ))}
            {d.items.length > 4 && <div className="week-item muted">+ {d.items.length - 4} weitere</div>}
          </div>
        ))}
      </div>
      {empty && (
        <p className="small muted" style={{ margin: "10px 2px 0" }}>
          {calendarConnected ? "Für diese Woche ist noch nichts geplant." : "Verbinde ein Google-Konto mit Kalenderzugriff, damit hier deine Termine erscheinen."}
        </p>
      )}
    </section>
  );
}
