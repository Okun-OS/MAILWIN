import Link from "next/link";
import { Icon, type IconName } from "../Icon";

const ACTIONS: { href: string; label: string; icon: IconName; cls: string }[] = [
  { href: "/emails/neu", label: "E-Mail schreiben", icon: "mail", cls: "qa-green" },
  { href: `/marvin?prompt=${encodeURIComponent("Marvin, bring Ordnung in mein Postfach.")}`, label: "Postfach ordnen", icon: "folder", cls: "qa-blue" },
  { href: "/projekte/neu", label: "Projekt starten", icon: "plus", cls: "qa-violet" },
  { href: "/einstellungen#signaturen", label: "Signatur erstellen", icon: "pen", cls: "qa-teal" },
];

export function QuickActions() {
  return (
    <section className="card quick" aria-label="Schnell starten">
      <div className="quick-title">
        <Icon name="bolt" size={26} className="" />
        <div>
          <b>Schnell starten</b>
          <small>Mit einem Klick produktiver.</small>
        </div>
      </div>
      {ACTIONS.map((a) => (
        <Link key={a.href} href={a.href} className={a.cls}>
          <span className="qa-i">
            <Icon name={a.icon} size={16} />
          </span>
          {a.label}
          <span className="chevron">
            <Icon name="chevronRight" size={16} />
          </span>
        </Link>
      ))}
    </section>
  );
}
