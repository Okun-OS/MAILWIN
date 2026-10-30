import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { integrations } from "@/lib/env";
import { channels } from "@/lib/notify";
import { maskTarget } from "@/lib/auth/twofactor";
import { SecuritySection } from "@/components/SecuritySection";
import { ImapConnectForm } from "@/components/ImapConnectForm";
import { listAccounts } from "@/lib/mail/accounts";
import { PermissionSelect } from "@/components/PermissionSelect";
import { SignatureForm } from "@/components/SignatureForm";
import { ActionButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import { disconnectAccountAction, setTimezoneAction, syncNowAction } from "../actions";

export const metadata = { title: "Einstellungen" };

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Verbunden", cls: "badge-green" },
  reauth_required: { label: "Neu verbinden", cls: "badge-red" },
  error: { label: "Fehler", cls: "badge-red" },
  disconnected: { label: "Getrennt", cls: "" },
};

const TIMEZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "Europe/Paris", "America/New_York", "UTC"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ verbunden?: string; fehler?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [accounts, signatures, [sessions]] = await Promise.all([
    listAccounts(user.id),
    db.select().from(schema.signatures).where(eq(schema.signatures.userId, user.id)),
    db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, user.id)),
  ]);
  const fmt = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "short", timeStyle: "short" }) : "noch nie");

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Einstellungen</h1>
          <p>Konten, Berechtigungen, Signaturen und Datenschutz.</p>
        </div>
      </div>
      {sp.verbunden && <div className="notice" style={{ marginBottom: 16 }}>Konto verbunden. Die erste Synchronisation läuft im Hintergrund.</div>}
      {sp.fehler === "weitere_postfaecher" && (
        <div className="notice error" style={{ marginBottom: 16 }}>Weitere Postfächer sind in deinem Tarif nicht freigeschaltet. Bitte wende dich an den Support.</div>
      )}

      <div className="stack">
        <section className="card card-pad" id="konten">
          <div className="card-head">
            <span className="head-icon"><Icon name="mail" /></span>
            <div>
              <h2>E-Mail-Konten</h2>
              <p>Zugriff per OAuth – Passwörter werden nie gespeichert, Zugangstoken nur verschlüsselt.</p>
            </div>
            <div className="end">
              {integrations.google && (
                <a className="btn btn-primary btn-sm" href="/api/auth/google/start?intent=connect">
                  <Icon name="plus" size={14} /> Gmail-Konto verbinden
                </a>
              )}
            </div>
          </div>
          {accounts.length ? (
            <table className="table">
              <thead>
                <tr><th>Konto</th><th>Status</th><th>Marvins Freigabestufe</th><th>Letzte Synchronisation</th><th /></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.emailAddress}</b>
                      <div className="small muted">{a.provider === "gmail" ? "Gmail" : a.provider === "imap" ? `IMAP · ${String(a.settings.imapHost ?? "")}` : "Microsoft 365"}{a.calendarEnabled ? " · Kalender verbunden" : ""}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS[a.status]?.cls ?? ""}`}>{STATUS[a.status]?.label ?? a.status}</span>
                      {a.lastError && <div className="small" style={{ color: "var(--mw-red-500)", marginTop: 4, maxWidth: 260 }}>{a.lastError}</div>}
                    </td>
                    <td><PermissionSelect accountId={a.id} value={a.permissionLevel} /></td>
                    <td className="small muted">{fmt(a.lastSyncedAt)}</td>
                    <td>
                      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                        {a.status === "reauth_required" ? (
                          <a className="btn btn-sm btn-primary" href={a.provider === "gmail" ? "/api/auth/google/start?intent=connect" : "#weitere-postfaecher"}>Neu verbinden</a>
                        ) : (
                          <ActionButton action={syncNowAction.bind(null, a.id)} title="Jetzt synchronisieren"><Icon name="refresh" size={14} /></ActionButton>
                        )}
                        <ActionButton
                          className="btn btn-sm btn-danger"
                          action={disconnectAccountAction.bind(null, a.id)}
                          confirm={`${a.emailAddress} trennen? Zugangsdaten und alle synchronisierten Daten dieses Kontos werden aus Mailwin gelöscht (dein Postfach bei Google bleibt unverändert).`}
                        >
                          Trennen
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty"><b>Noch kein Konto verbunden</b>Verbinde dein Gmail- oder Google-Workspace-Konto.</div>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            Microsoft 365/Outlook, iCloud, GMX, WEB.DE und IMAP-Konten folgen in einer späteren Ausbaustufe. Senden erfolgt in jeder Stufe nur nach deiner ausdrücklichen Freigabe;
            Papierkorb-Aktionen brauchen eine gesonderte Bestätigung, dauerhaftes Löschen ist ausgeschlossen.
          </p>
        </section>

        <section className="card card-pad" id="weitere-postfaecher">
          <div className="card-head">
            <span className="head-icon"><Icon name="inbox" /></span>
            <div>
              <h2>Weiteres Postfach verbinden</h2>
              <p>GMX, WEB.DE, T-Online, iCloud, Yahoo, IONOS, STRATO oder eigene Domain über IMAP/SMTP.</p>
            </div>
          </div>
          <ImapConnectForm />
        </section>

        <section id="signaturen">
          <div className="page-title" style={{ margin: "4px 0 12px" }}>
            <div>
              <h1 style={{ fontSize: 20 }}>Signaturen</h1>
              <p>Wird beim Versand über das jeweilige Konto automatisch angehängt.</p>
            </div>
          </div>
          {accounts.length ? (
            <div className="split">
              {accounts.map((a) => {
                const sig = signatures.find((s) => s.accountId === a.id);
                return <SignatureForm key={a.id} accountId={a.id} email={a.emailAddress} initial={sig ? { name: sig.name, text: sig.text } : null} />;
              })}
            </div>
          ) : (
            <div className="card empty">Verbinde zuerst ein Konto.</div>
          )}
        </section>

        <SecuritySection
          hasPassword={Boolean(user.passwordHash)}
          method={user.twoFactorMethod}
          phoneMasked={user.phone ? maskTarget(user.phone) : null}
          emailAvailable={channels.email}
          smsAvailable={channels.sms}
          sessionCount={sessions?.n ?? 1}
        />

        <section className="card card-pad">
          <div className="card-head">
            <span className="head-icon"><Icon name="user" /></span>
            <div><h2>Profil</h2><p>{user.email}</p></div>
          </div>
          <form action={setTimezoneAction} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="tz">Zeitzone</label>
              <select id="tz" name="timezone" className="select" defaultValue={user.timezone} style={{ width: 240 }}>
                {[...new Set([user.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <button className="btn">Speichern</button>
          </form>
        </section>

        <section className="card card-pad">
          <div className="card-head">
            <span className="head-icon"><Icon name="eye" /></span>
            <div><h2>Datenschutz & Kontrolle</h2><p>Jede Aktion von dir, Marvin und Automationen wird protokolliert.</p></div>
            <div className="end"><Link href="/aktivitaeten" className="link-more">Aktivitätsprotokoll <Icon name="arrowRight" size={14} /></Link></div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Inhalte aus E-Mails werden zur Bearbeitung an Marvin (Claude-API von Anthropic) übermittelt, sobald du ihn fragst. Beim Trennen eines Kontos werden dessen Daten aus
            Mailwin gelöscht.
          </p>
          <a className="btn btn-sm" href="/api/export" style={{ marginTop: 12 }}>Meine Daten herunterladen (JSON)</a>
        </section>
      </div>
    </>
  );
}
