"use client";

import { useActionState } from "react";
import type { AdminState } from "@/app/(app)/admin/actions";

/** Formular-Hülle für Admin-Aktionen mit Rückmeldung; zeigt einmalige Geheimnisse (z. B. Startpasswort) hervorgehoben. */
export function AdminForm({
  action,
  children,
  submit,
  danger,
  inline,
}: {
  action: (prev: AdminState, form: FormData) => Promise<AdminState>;
  children?: React.ReactNode;
  submit: string;
  danger?: boolean;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<AdminState, FormData>(action, null);
  return (
    <form action={formAction} style={inline ? { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" } : undefined}>
      {state?.error && <div className="notice error" style={{ marginBottom: 10, width: "100%" }}>{state.error}</div>}
      {state?.message && (
        <div className="notice" style={{ marginBottom: 10, width: "100%", flexDirection: "column", gap: 6 }}>
          <span>{state.message}</span>
          {state.secret && (
            <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.04em", background: "#fff", padding: "8px 12px", borderRadius: 8, userSelect: "all" }}>{state.secret}</code>
          )}
        </div>
      )}
      {children}
      <button className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`} disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
