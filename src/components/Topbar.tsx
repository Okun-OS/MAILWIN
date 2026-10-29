import Link from "next/link";
import { Icon } from "./Icon";
import { NavToggle } from "./NavToggle";

export function Topbar({ user, unreadNotifications }: { user: { name: string | null; email: string }; unreadNotifications: number }) {
  const initials = (user.name ?? user.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  return (
    <header className="topbar">
      <NavToggle />
      <form className="search" action="/suche" role="search">
        <Icon name="search" />
        <input name="q" placeholder="Nach E-Mails, Kontakten, Aufgaben oder Projekten suchen …" aria-label="Suche" />
      </form>
      <div className="topbar-actions">
        <Link href="/benachrichtigungen" className="icon-btn" aria-label={`Benachrichtigungen (${unreadNotifications} ungelesen)`}>
          <Icon name="bell" size={20} />
          {unreadNotifications > 0 && <span className="dot" />}
        </Link>
        <Link href="/einstellungen" className="avatar" title={user.name ?? user.email}>
          {initials}
        </Link>
      </div>
    </header>
  );
}
