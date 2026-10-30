"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./Icon";

const MAIN: { href: string; label: string; icon: IconName; countKey?: "approvals" }[] = [
  { href: "/", label: "Start", icon: "home" },
  { href: "/emails", label: "E-Mails", icon: "mail" },
  { href: "/kalender", label: "Kalender", icon: "calendar" },
  { href: "/aufgaben", label: "Aufgaben", icon: "checkSquare" },
  { href: "/projekte", label: "Projekte", icon: "folder" },
  { href: "/freigaben", label: "Freigaben", icon: "check", countKey: "approvals" },
  { href: "/marvin", label: "Marvin", icon: "robot" },
];
const SECONDARY: { href: string; label: string; icon: IconName }[] = [
  { href: "/suche", label: "Suche", icon: "search" },
  { href: "/einstellungen", label: "Einstellungen", icon: "settings" },
];

export function Sidebar({ user, counts }: { user: { name: string | null; email: string; avatarUrl: string | null; isAdmin: boolean }; counts: { approvals: number } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("mw:toggle-nav", toggle);
    return () => window.removeEventListener("mw:toggle-nav", toggle);
  }, []);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const initials = (user.name ?? user.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");

  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Hauptnavigation">
      <Brand />
      <nav className="nav">
        {MAIN.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : undefined}>
            <Icon name={item.icon} />
            {item.label}
            {item.countKey && counts[item.countKey] > 0 && <span className="count">{counts[item.countKey]}</span>}
          </Link>
        ))}
      </nav>
      <div className="nav-spacer" />
      <nav className="nav">
        {user.isAdmin && (
          <Link href="/admin" className={isActive("/admin") ? "active" : undefined}>
            <Icon name="settings" />
            Admin
          </Link>
        )}
        {SECONDARY.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : undefined}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="user-card">
        <span className="avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials}
        </span>
        <span className="who">
          <b>{user.name ?? user.email}</b>
          <small>{user.email}</small>
        </span>
        <form action="/api/auth/logout" method="post">
          <button className="icon-btn" title="Abmelden" aria-label="Abmelden">
            <Icon name="logout" size={17} />
          </button>
        </form>
      </div>
    </aside>
  );
}
