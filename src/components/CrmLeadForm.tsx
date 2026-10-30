"use client";

import { useActionState } from "react";
import { createLeadAction, type CrmCardState } from "@/app/(app)/emails/crm-actions";

export interface StageOption {
  value: string;
  label: string;
  group: string;
}

/** Formular „Als Lead anlegen“ – vorbelegt aus der Konversation. */
export function CrmLeadForm(props: { threadId: string; title: string; description: string; companyName: string; stages: StageOption[] }) {
  const [state, action, pending] = useActionState<CrmCardState, FormData>(createLeadAction, null);
  const groups = [...new Set(props.stages.map((s) => s.group))];
  if (state?.ok) return <div className="notice">{state.message}</div>;
  return (
    <form action={action}>
      <input type="hidden" name="threadId" value={props.threadId} />
      {state?.error && <div className="notice error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="field">
        <label>Titel</label>
        <input className="input" name="title" required maxLength={160} defaultValue={props.title} />
      </div>
      <div className="field">
        <label>Beschreibung</label>
        <textarea className="textarea" name="description" rows={4} maxLength={10_000} defaultValue={props.description} />
      </div>
      <div className="split" style={{ gap: 12 }}>
        <div className="field">
          <label>Firma (optional)</label>
          <input className="input" name="companyName" maxLength={160} defaultValue={props.companyName} />
        </div>
        <div className="field">
          <label>Wert in € (optional)</label>
          <input className="input" name="value" inputMode="decimal" placeholder="z. B. 24.000" />
        </div>
      </div>
      {props.stages.length > 0 && (
        <div className="field">
          <label>Phase</label>
          <select className="select" name="stage" defaultValue="">
            <option value="">Standard (erste Phase der Standard-Pipeline)</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {props.stages.filter((s) => s.group === g).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "Wird angelegt …" : "Im CRM anlegen"}</button>
      <small className="muted" style={{ display: "block", marginTop: 8 }}>
        Kontakt und Firma legt das CRM bei Bedarf an. Die Nachrichten dieser Konversation werden am Lead protokolliert.
      </small>
    </form>
  );
}
