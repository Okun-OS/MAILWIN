"use client";

import { useActionState } from "react";
import { crmLinkAction, type CrmCardState } from "@/app/(app)/emails/crm-actions";

/** Knopf „zuordnen“ / „Zuordnung lösen“ mit Fehlermeldung direkt am Knopf. */
export function CrmLinkButton(props: { threadId: string; leadId?: string; op?: "link" | "unlink"; confirm?: string; className?: string; children: React.ReactNode }) {
  const [state, action, pending] = useActionState<CrmCardState, FormData>(crmLinkAction, null);
  return (
    <form
      action={action}
      style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
      onSubmit={(e) => {
        if (props.confirm && !window.confirm(props.confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="threadId" value={props.threadId} />
      <input type="hidden" name="op" value={props.op ?? "link"} />
      {props.leadId && <input type="hidden" name="leadId" value={props.leadId} />}
      <button className={props.className ?? "btn btn-sm"} disabled={pending}>
        {pending ? "Einen Moment …" : props.children}
      </button>
      {state?.error && <span className="small" style={{ color: "var(--mw-red-500)" }}>{state.error}</span>}
    </form>
  );
}
