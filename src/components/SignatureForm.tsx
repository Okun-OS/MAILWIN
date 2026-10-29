"use client";

import { useActionState } from "react";
import { saveSignatureAction, type ActionState } from "@/app/(app)/actions";

export function SignatureForm({ accountId, email, initial }: { accountId: string; email: string; initial: { name: string; text: string } | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSignatureAction, null);
  return (
    <form action={action} className="card card-pad">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="card-head">
        <h2 style={{ fontSize: 14 }}>{email}</h2>
      </div>
      <div className="field">
        <label>Bezeichnung</label>
        <input className="input" name="name" defaultValue={initial?.name ?? "Geschäftlich"} />
      </div>
      <div className="field">
        <label>Signatur</label>
        <textarea className="textarea" name="text" style={{ minHeight: 120 }} defaultValue={initial?.text ?? ""} placeholder={"Sarah Neumann\nProjektleitung · OKUN Software GmbH\nTel. +49 …\nwww.okun.de"} />
      </div>
      {state?.error && <div className="notice error">{state.error}</div>}
      {state?.message && <div className="notice">{state.message}</div>}
      <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={pending}>Speichern</button>
      </div>
    </form>
  );
}
