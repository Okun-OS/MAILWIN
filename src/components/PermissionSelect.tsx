"use client";

import { useTransition } from "react";
import { setPermissionLevelAction } from "@/app/(app)/actions";

export function PermissionSelect({ accountId, value }: { accountId: string; value: "read" | "organize" | "communicate" }) {
  const [pending, start] = useTransition();
  return (
    <select
      className="select"
      defaultValue={value}
      disabled={pending}
      aria-label="Freigabestufe"
      onChange={(e) => start(() => setPermissionLevelAction(accountId, e.target.value as typeof value))}
      style={{ maxWidth: 320 }}
    >
      <option value="read">Stufe 1 – Lesen & Analysieren</option>
      <option value="organize">Stufe 2 – Organisieren (Labels, Archiv)</option>
      <option value="communicate">Stufe 3 – Kommunizieren (Versand nach Freigabe)</option>
    </select>
  );
}
