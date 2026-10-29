import Link from "next/link";
import { Icon, type IconName } from "../Icon";
import { MarvinIcon } from "../Marvin";
import type { Recommendation } from "@/lib/dashboard/greeting";

const STYLE: Record<Recommendation["kind"], { icon: IconName; bg: string; fg: string }> = {
  connect: { icon: "mail", bg: "var(--mw-mint-100)", fg: "var(--mw-green-600)" },
  warning: { icon: "alert", bg: "var(--mw-red-50)", fg: "var(--mw-red-500)" },
  approval: { icon: "mail", bg: "var(--mw-red-50)", fg: "var(--mw-red-500)" },
  followup: { icon: "lightbulb", bg: "var(--mw-amber-50)", fg: "var(--mw-amber-500)" },
  calendar: { icon: "calendar", bg: "var(--mw-blue-50)", fg: "var(--mw-blue-500)" },
};

export function MarvinCard({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <section className="card marvin-card" aria-label="Marvin">
      <div className="marvin-head">
        <MarvinIcon size={40} />
        <div style={{ flex: 1 }}>
          <b>
            Marvin<span className="online" aria-hidden="true" />
          </b>
          <small>Dein KI-Assistent</small>
        </div>
      </div>
      <div className="reco-list">
        <div className="small" style={{ padding: "2px 8px 4px", color: "var(--mw-ink-700)" }}>
          {recommendations.length ? (
            <>
              Ich habe {recommendations.length === 1 ? "eine" : "ein paar"} <b>Empfehlung{recommendations.length === 1 ? "" : "en"}</b> für dich:
            </>
          ) : (
            "Alles im Griff – aktuell habe ich keine offenen Empfehlungen."
          )}
        </div>
        {recommendations.slice(0, 4).map((r, i) => {
          const s = STYLE[r.kind];
          const inner = (
            <>
              <span className="ri" style={{ background: s.bg, color: s.fg }}>
                <Icon name={s.icon} size={16} />
              </span>
              <span>{r.text}</span>
            </>
          );
          return r.href ? (
            <Link key={i} href={r.href} className="reco">
              {inner}
            </Link>
          ) : (
            <div key={i} className="reco">
              {inner}
            </div>
          );
        })}
      </div>
      <Link href="/marvin" className="btn btn-primary" style={{ width: "100%" }}>
        Mit Marvin sprechen <Icon name="arrowRight" size={16} />
      </Link>
    </section>
  );
}
