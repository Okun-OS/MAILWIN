"use client";

import { useActionState } from "react";
import { sendEmailAction, type ActionState } from "@/app/(app)/actions";
import { Icon } from "./Icon";

export interface ComposeDefaults {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  replyToEmailId?: string;
  forwardEmailId?: string;
  quoted?: string;
}

export function ComposeForm({ accounts, defaults, signature }: { accounts: { id: string; email: string }[]; defaults: ComposeDefaults; signature: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendEmailAction, null);
  const locked = Boolean(defaults.replyToEmailId);
  return (
    <form action={action} className="card card-pad" style={{ maxWidth: 900 }}>
      {state?.error && <div className="notice error" style={{ marginBottom: 14 }}>{state.error}</div>}
      <div className="field">
        <label htmlFor="accountId">Von</label>
        <select id="accountId" name="accountId" className="select" defaultValue={defaults.accountId} disabled={locked}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
        {locked && <input type="hidden" name="accountId" value={defaults.accountId} />}
      </div>
      <div className="field">
        <label htmlFor="to">An</label>
        <input id="to" name="to" className="input" defaultValue={defaults.to} placeholder="name@beispiel.de, weitere@beispiel.de" required />
      </div>
      <div className="field">
        <label htmlFor="cc">Cc</label>
        <input id="cc" name="cc" className="input" defaultValue={defaults.cc} />
      </div>
      <div className="field">
        <label htmlFor="subject">Betreff</label>
        <input id="subject" name="subject" className="input" defaultValue={defaults.subject} required />
      </div>
      <div className="field">
        <label htmlFor="body">Nachricht</label>
        <textarea id="body" name="body" className="textarea" defaultValue={defaults.body} required style={{ minHeight: 260 }} />
      </div>
      {signature && (
        <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: -4 }}>
          Signatur wird angehängt:{"\n"}
          {signature}
        </p>
      )}
      {defaults.quoted && <p className="small muted">{defaults.quoted}</p>}
      {defaults.replyToEmailId && <input type="hidden" name="replyToEmailId" value={defaults.replyToEmailId} />}
      {defaults.forwardEmailId && <input type="hidden" name="forwardEmailId" value={defaults.forwardEmailId} />}
      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="send" size={16} /> {pending ? "Wird gesendet …" : "Senden"}
        </button>
      </div>
    </form>
  );
}
