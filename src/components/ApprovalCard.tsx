"use client";

import { useActionState, useState } from "react";
import { approveAction, rejectAction, type ActionState } from "@/app/(app)/actions";
import { Icon } from "./Icon";

type Address = { name?: string; email: string };
interface Props {
  approval: {
    id: string;
    action: string;
    status: string;
    summary: string;
    risk: string;
    payload: Record<string, unknown>;
    result: Record<string, unknown> | null;
  };
  accountEmail?: string;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Wartet auf Freigabe", cls: "badge-violet" },
  approved: { label: "Wird ausgeführt", cls: "badge-blue" },
  executed: { label: "Ausgeführt", cls: "badge-green" },
  rejected: { label: "Abgelehnt", cls: "badge" },
  failed: { label: "Fehlgeschlagen", cls: "badge-red" },
  expired: { label: "Abgelaufen", cls: "badge" },
};

const fmt = (list: unknown) => ((list as Address[] | undefined) ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");

/** Freigabe-Karte: vollständige Kontrolle über Empfänger, Betreff und Inhalt vor dem Versand (Spezifikation 9.4). */
export function ApprovalCard({ approval, accountEmail }: Props) {
  const [approveState, approveFormAction, approving] = useActionState<ActionState, FormData>(approveAction, null);
  const [rejectState, rejectFormAction, rejecting] = useActionState<ActionState, FormData>(rejectAction, null);
  const [editing, setEditing] = useState(false);
  const p = approval.payload;
  const isEmail = approval.action === "send_email";
  const status = STATUS[approval.status] ?? STATUS.pending!;
  const pending = approval.status === "pending" && !approveState?.ok && !rejectState?.ok;
  const error = approveState?.error ?? rejectState?.error ?? (approval.status === "failed" ? String(approval.result?.error ?? "") : null);

  return (
    <div className="draft-card" id={approval.id}>
      <header>
        <Icon name={isEmail ? "mail" : "trash"} size={16} />
        <span style={{ flex: 1 }}>{isEmail ? "E-Mail-Entwurf zur Freigabe" : "Kritische Aktion zur Bestätigung"}</span>
        <span className={`badge ${status.cls}`}>{approveState?.ok ? "Ausgeführt" : rejectState?.ok ? "Abgelehnt" : status.label}</span>
      </header>
      <form action={approveFormAction}>
        <input type="hidden" name="id" value={approval.id} />
        <div className="body">
          {isEmail ? (
            editing ? (
              <>
                <div className="field">
                  <label>An</label>
                  <input className="input" name="to" defaultValue={fmt(p.to)} />
                </div>
                <div className="field">
                  <label>Cc</label>
                  <input className="input" name="cc" defaultValue={fmt(p.cc)} />
                </div>
                <div className="field">
                  <label>Betreff</label>
                  <input className="input" name="subject" defaultValue={String(p.subject ?? "")} />
                </div>
                <div className="field">
                  <label>Text</label>
                  <textarea className="textarea" name="body" defaultValue={String(p.body ?? "")} />
                </div>
              </>
            ) : (
              <>
                {accountEmail && (
                  <div className="row">
                    <span>Von</span>
                    <span>{accountEmail}</span>
                  </div>
                )}
                <div className="row">
                  <span>An</span>
                  <span>{fmt(p.to)}</span>
                </div>
                {fmt(p.cc) && (
                  <div className="row">
                    <span>Cc</span>
                    <span>{fmt(p.cc)}</span>
                  </div>
                )}
                <div className="row">
                  <span>Betreff</span>
                  <b>{String(p.subject ?? "")}</b>
                </div>
                {Boolean(p.replyToEmailId) && (
                  <div className="row">
                    <span>Verlauf</span>
                    <span>Antwort im bestehenden Verlauf</span>
                  </div>
                )}
                {Boolean(p.forwardEmailId) && (
                  <div className="row">
                    <span>Anhang</span>
                    <span>Ursprüngliche Nachricht inkl. Anhängen wird angefügt</span>
                  </div>
                )}
                <div className="mail-text" style={{ marginTop: 10, padding: 12, background: "var(--mw-page)", borderRadius: 10 }}>
                  {String(p.body ?? "")}
                </div>
                <p className="small muted" style={{ marginBottom: 0 }}>Deine Signatur wird beim Versand automatisch angehängt.</p>
              </>
            )
          ) : (
            <p style={{ margin: 0 }}>{approval.summary}</p>
          )}
          {error && <div className="notice error" style={{ marginTop: 10 }}>{error}</div>}
        </div>
        {pending && (
          <footer>
            <button type="submit" formAction={rejectFormAction} className="btn btn-sm" disabled={approving || rejecting}>
              Ablehnen
            </button>
            {isEmail && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing((e) => !e)}>
                <Icon name="pen" size={14} /> {editing ? "Vorschau" : "Bearbeiten"}
              </button>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={approving || rejecting}>
              <Icon name={isEmail ? "send" : "check"} size={14} />
              {approving ? "Wird ausgeführt …" : isEmail ? "Prüfen & senden" : "Bestätigen"}
            </button>
          </footer>
        )}
      </form>
    </div>
  );
}
