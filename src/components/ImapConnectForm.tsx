"use client";

import { useActionState, useState } from "react";
import { connectImapAction, type MailboxState } from "@/app/(app)/einstellungen/mailbox-actions";
import { PRESETS } from "@/lib/mail/imap-presets";

export function ImapConnectForm() {
  const [state, action, pending] = useActionState<MailboxState, FormData>(connectImapAction, null);
  const [preset, setPreset] = useState("gmx");
  const p = PRESETS.find((x) => x.key === preset);
  return (
    <form action={action} style={{ maxWidth: 640 }}>
      {state?.error && <div className="notice error" style={{ marginBottom: 12 }}>{state.error}</div>}
      {state?.message && <div className="notice" style={{ marginBottom: 12 }}>{state.message}</div>}
      <div className="field">
        <label>Anbieter</label>
        <select className="select" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          <option value="custom">Anderer Anbieter / eigene Domain (IMAP)</option>
        </select>
        {p && <small className="muted">{p.hint}</small>}
      </div>
      <div className="split" style={{ gap: 12 }}>
        <div className="field"><label>E-Mail-Adresse</label><input className="input" name="email" type="email" required autoComplete="off" /></div>
        <div className="field"><label>Passwort bzw. App-Passwort</label><input className="input" name="password" type="password" required autoComplete="new-password" /></div>
      </div>
      {!p && (
        <>
          <div className="field"><label>Benutzername (falls abweichend von der E-Mail-Adresse)</label><input className="input" name="username" /></div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field"><label>Posteingangsserver (IMAP)</label><input className="input" name="imapHost" placeholder="imap.example.de" required /></div>
            <div className="field"><label>Port</label><input className="input" name="imapPort" type="number" defaultValue={993} /></div>
          </div>
          <div className="split" style={{ gap: 12 }}>
            <div className="field"><label>Postausgangsserver (SMTP)</label><input className="input" name="smtpHost" placeholder="smtp.example.de" required /></div>
            <div className="field"><label>Port</label><input className="input" name="smtpPort" type="number" defaultValue={587} /></div>
          </div>
          <label className="small" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="checkbox" name="appendSent" value="on" defaultChecked /> Gesendete E-Mails im Ordner „Gesendet“ ablegen
          </label>
        </>
      )}
      <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "Verbindung wird geprüft …" : "Postfach verbinden"}</button>
      <p className="small muted" style={{ marginTop: 10 }}>
        Das Passwort wird verschlüsselt gespeichert und nur für die Verbindung zu deinem Mailserver verwendet. Synchronisiert werden Posteingang und Gesendet; Ordner
        erscheinen in Mailwin als Labels.
      </p>
    </form>
  );
}
