"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/kunden", label: "Kunden" },
  { href: "/admin/gutscheine", label: "Gutscheine" },
  { href: "/admin/aktionen", label: "Aktionen" },
  { href: "/admin/meldungen", label: "Systemmeldungen" },
  { href: "/admin/protokoll", label: "Protokoll" },
  { href: "/admin/system", label: "System" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Admin-Bereiche">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={(t.href === "/admin" ? path === "/admin" : path.startsWith(t.href)) ? "active" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
