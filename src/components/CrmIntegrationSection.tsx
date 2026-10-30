"use client";

import { useActionState } from "react";
import {
  checkCrmAction,
  connectCrmAction,
  disconnectCrmAction,
  removeWebhookSecretAction,
  setWebhookSecretAction,
  updateCrmSettingsAction,
  type CrmState,
} from "@/app/(app)/einstellungen/integration-actions";
import type { CrmSettings } from "@/lib/db/schema";
import { ActionButton } from "./ConfirmButton";
import { Icon } from "./Icon";

export interface CrmView {
  baseUrl: string;
  workspaceName: string | null;
  workspaceAppUrl: string | null;
  status: "active" | "error";
  lastError: string | null;
  lastWebhook: string | null;
  settings: CrmSettings;
  hasSecret: boolean;
  webhookUrl: string;
}

function Notice({ state }: { state: CrmState }) {
  if (state?.error) return <div className="notice error" style={{ marginBottom: 12 }}>{state.error}</div>;
  if (state?.message) return <div className="notice" style={{ marginBottom: 12 }}>{state.message}</div>;
  return null;
}

function ConnectForm({ replace, defaultUrl }: { replace?: boolean; defaultUrl?: string }) {
  const [state, action, pending] = useActionState<CrmState, FormData>(connectCrmAction, null);
  const url = state?.values?.baseUrl ?? defaultUrl ?? "";
  return (
    <form action={action} style={{ maxWidth: 640 }}>
      <Notice state={state} />
      <div className="field">
        <label>Adresse des CRM</label>
        <input className="input" name="baseUrl" type="url" required placeholder="https://crm.okun-systems.com" defaultValue={url} key={`url-${url}`} autoComplete="off" />
        <small className="muted">Die Adresse, unter der du dein OKUN CRM im Browser öffnest.</small>
      </div>
      <div className="field">
        <label>{replace ? "Neuer API-Schlüssel" : "API-Schlüssel"}</label>
        <input className="input" name="apiKey" type="password" required placeholder="okun_mw_…" autoComplete="new-password" />
        <small className="muted">Im CRM unter Einstellungen → Integrationen → Mailwin → „Schlüssel erzeugen“.</small>
      </div>
      <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "Verbindung wird geprüft …" : replace ? "Schlüssel ersetzen" : "CRM verbinden"}</button>
    </form>
  );
}

function SettingsForm({ settings }: { settings: CrmSettings }) {
  const [state, action, pending] = useActionState<CrmState, FormData>(updateCrmSettingsAction, null);
  return (
    <form action={action}>
      <Notice state={state} />
      <div className="field">
        <label>Nachrichten ins CRM übertragen</label>
        <select className="select" name="logMode" defaultValue={settings.logMode}>
          <option value="linked">Nur zugeordnete Konversationen (empfohlen)</option>
          <option value="known_contacts">Zusätzlich alle Konversationen mit CRM-Kontakten automatisch zuordnen</option>
          <option value="off">Keine Nachrichten übertragen (nur Leads anlegen)</option>
        </select>
        <small className="muted">
          Eingehende Antworten an einem Lead stoppen im CRM geplante Nachfass-Automationen. Automatisch zugeordnet wird nur, wenn der Kontakt genau einen offenen Lead hat;
          sonst nur dem Kontakt.
        </small>
      </div>
      <div className="split" style={{ gap: 12 }}>
        <div className="field">
          <label>Inhalt der Nachrichten</label>
          <select className="select" name="content" defaultValue={settings.content}>
            <option value="preview">Betreff und Anfang der Nachricht (ca. 500 Zeichen)</option>
            <option value="full">Vollständiger Text</option>
          </select>
        </div>
        <div className="field">
          <label>Leads durch Marvin</label>
          <select className="select" name="leadMode" defaultValue={settings.leadMode}>
            <option value="approval">Immer erst fragen (Freigabe)</option>
            <option value="direct">Direkt anlegen</option>
          </select>
        </div>
      </div>
      <button className="btn btn-sm" disabled={pending}>{pending ? "Speichert …" : "Einstellungen speichern"}</button>
    </form>
  );
}

function WebhookForm({ hasSecret, webhookUrl }: { hasSecret: boolean; webhookUrl: string }) {
  const [state, action, pending] = useActionState<CrmState, FormData>(setWebhookSecretAction, null);
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Damit Mailwin Phasenwechsel und gewonnene oder verlorene Leads erfährt, trage im CRM unter Integrationen → Mailwin diese Webhook-Adresse und ein gemeinsames
        Geheimnis ein.
      </p>
      <div className="field">
        <label>Webhook-Adresse</label>
        <input className="input" readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <Notice state={state} />
      {state?.secret && (
        <div className="field">
          <label>Neues Geheimnis (nur jetzt sichtbar)</label>
          <input className="input" readOnly value={state.secret} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "ui-monospace, monospace" }} />
        </div>
      )}
      <form action={action} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0, flex: "1 1 260px" }}>
          <label>{hasSecret ? "Geheimnis ersetzen (aus dem CRM)" : "Geheimnis aus dem CRM einfügen"}</label>
          <input className="input" name="secret" type="password" autoComplete="new-password" placeholder={hasSecret ? "•••••••• hinterlegt" : ""} />
        </div>
        <button className="btn btn-sm" disabled={pending}>Speichern</button>
        <button className="btn btn-sm" name="generate" value="1" disabled={pending} formNoValidate>
          Hier erzeugen
        </button>
      </form>
      {hasSecret && (
        <div style={{ marginTop: 10 }}>
          <ActionButton action={removeWebhookSecretAction} confirm="Webhook-Geheimnis entfernen? Mailwin nimmt dann keine Rückmeldungen des CRM mehr an." className="btn btn-sm btn-ghost">
            Geheimnis entfernen
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function CheckButton() {
  const [state, action, pending] = useActionState<CrmState, FormData>(checkCrmAction, null);
  return (
    <form action={action} style={{ display: "inline" }}>
      <button className="btn btn-sm" disabled={pending}><Icon name="refresh" size={14} /> {pending ? "Prüft …" : "Verbindung prüfen"}</button>
      {(state?.message || state?.error) && <span className={`small ${state.error ? "" : "muted"}`} style={{ marginLeft: 10, color: state.error ? "var(--mw-red-500)" : undefined }}>{state.error ?? state.message}</span>}
    </form>
  );
}

/** Einstellungen → Integrationen: OKUN CRM verbinden und steuern, was Mailwin überträgt. */
export function CrmIntegrationSection({ crm, enabled }: { crm: CrmView | null; enabled: boolean }) {
  return (
    <section className="card card-pad" id="integrationen">
      <div className="card-head">
        <span className="head-icon"><Icon name="briefcase" /></span>
        <div>
          <h2>CRM-Anbindung</h2>
          <p>Leads aus E-Mails anlegen, Nachrichten am Lead protokollieren, Phasen in Mailwin sehen.</p>
        </div>
        {crm && (
          <div className="end">
            <span className={`badge ${crm.status === "active" ? "badge-green" : "badge-red"}`}>{crm.status === "active" ? "Verbunden" : "Unterbrochen"}</span>
          </div>
        )}
      </div>

      {!enabled ? (
        <p className="small muted" style={{ margin: 0 }}>Die CRM-Anbindung ist für dein Konto nicht freigeschaltet. Bitte wende dich an den Support.</p>
      ) : !crm ? (
        <ConnectForm />
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Arbeitsbereich</dt>
            <dd>
              <b>OKUN CRM · {crm.workspaceName ?? "unbekannt"}</b>
              {crm.workspaceAppUrl && <> · <a href={crm.workspaceAppUrl} target="_blank" rel="noreferrer">öffnen</a></>}
            </dd>
            <dt>Schnittstelle</dt>
            <dd className="small">{crm.baseUrl}</dd>
            <dt>Rückmeldungen</dt>
            <dd>{crm.hasSecret ? (crm.lastWebhook ? `aktiv, zuletzt ${crm.lastWebhook}` : "eingerichtet, noch keine empfangen") : "nicht eingerichtet"}</dd>
          </dl>
          {crm.status === "error" && (
            <div className="notice error">
              Die Verbindung ist unterbrochen{crm.lastError ? `: ${crm.lastError}` : "."} Erzeuge im CRM einen neuen Schlüssel und trage ihn unten ein.
            </div>
          )}
          <div><CheckButton /></div>
          <SettingsForm settings={crm.settings} />
          <details>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Rückmeldungen vom CRM (Webhook)</summary>
            <div style={{ marginTop: 12 }}><WebhookForm hasSecret={crm.hasSecret} webhookUrl={crm.webhookUrl} /></div>
          </details>
          <details open={crm.status === "error"}>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>API-Schlüssel ersetzen</summary>
            <div style={{ marginTop: 12 }}><ConnectForm replace defaultUrl={crm.baseUrl.replace(/\/api\/mailwin\/v1$/, "")} /></div>
          </details>
          <div>
            <ActionButton
              action={disconnectCrmAction}
              confirm="CRM trennen? Die Zuordnungen in Mailwin werden gelöscht. Leads und Aktivitäten im CRM bleiben erhalten."
              className="btn btn-sm btn-ghost"
            >
              CRM trennen
            </ActionButton>
          </div>
        </div>
      )}
    </section>
  );
}
