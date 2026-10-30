import Link from "next/link";
import { notFound } from "next/navigation";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { channels } from "@/lib/notify";
import { FEATURES, hasFeature, type FeatureKey } from "@/lib/features";
import { formatUsd } from "@/lib/usage";
import { PLAN_LABEL, SUB_LABEL, TWOFA_LABEL } from "@/lib/admin-labels";
import { AdminForm } from "@/components/admin/AdminForms";
import { ActionButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import {
  addSupportNoteAction,
  deleteUserAction,
  logoutUserAction,
  resetTwoFactorAction,
  resyncAccountAction,
  sendResetLinkAction,
  setFeatureAction,
  setPasswordAction,
  setRoleAction,
  setStatusAction,
  unlockAction,
  updateProfileAction,
} from "../../actions";

const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) notFound();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [accounts, [sessions], notes, logs, [usageMonth], [usageTotal], [counts]] = await Promise.all([
    db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, id)),
    db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, id)),
    db
      .select({ note: schema.supportNotes, author: schema.users.email })
      .from(schema.supportNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.supportNotes.authorId))
      .where(eq(schema.supportNotes.userId, id))
      .orderBy(desc(schema.supportNotes.createdAt)),
    db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, id)).orderBy(desc(schema.auditLogs.createdAt)).limit(25),
    db.select({ cost: sql<number>`coalesce(sum(${schema.usageEvents.costMicros}),0)::int`, calls: count() }).from(schema.usageEvents).where(sql`${schema.usageEvents.userId} = ${id} and ${schema.usageEvents.createdAt} >= ${monthStart}`),
    db.select({ cost: sql<number>`coalesce(sum(${schema.usageEvents.costMicros}),0)::int`, calls: count() }).from(schema.usageEvents).where(eq(schema.usageEvents.userId, id)),
    db
      .select({
        emails: sql<number>`(select count(*)::int from ${schema.emails} where user_id = ${id})`,
        projects: sql<number>`(select count(*)::int from ${schema.projects} where user_id = ${id})`,
        tasks: sql<number>`(select count(*)::int from ${schema.tasks} where user_id = ${id})`,
        sent: sql<number>`(select count(*)::int from ${schema.approvalRequests} where user_id = ${id} and status = 'executed')`,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id)),
  ]);
  const locked = u.lockedUntil && u.lockedUntil > new Date();
  const self = u.id === admin.id;

  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link href="/admin/kunden" className="link-more"><Icon name="chevronLeft" size={14} /> Kunden</Link>
          <h2 style={{ fontSize: 22, marginTop: 6 }}>{u.name ?? u.email}</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {u.email} · seit {u.createdAt.toLocaleDateString("de-DE")} · {u.role === "admin" ? "Admin" : "Kunde"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {u.status === "disabled" ? <span className="badge badge-red">Gesperrt</span> : <span className="badge badge-green">Aktiv</span>}
          {locked && <span className="badge badge-amber">Login gesperrt bis {fmt(u.lockedUntil)}</span>}
          <span className="badge">{PLAN_LABEL[u.plan]} · {SUB_LABEL[u.subscriptionStatus]}</span>
          <span className="badge">2FA: {TWOFA_LABEL[u.twoFactorMethod]}</span>
        </div>
      </div>

      <div className="split" style={{ alignItems: "start" }}>
        <section className="card card-pad">
          <div className="card-head"><h2>Profil & Abo</h2></div>
          <AdminForm action={updateProfileAction} submit="Speichern">
            <input type="hidden" name="userId" value={u.id} />
            <div className="field"><label>Name</label><input className="input" name="name" defaultValue={u.name ?? ""} /></div>
            <div className="field"><label>E-Mail (Anmeldename)</label><input className="input" name="email" type="email" defaultValue={u.email} required /></div>
            <div className="split" style={{ gap: 12 }}>
              <div className="field">
                <label>Tarif</label>
                <select className="select" name="plan" defaultValue={u.plan}>
                  {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Abo-Status</label>
                <select className="select" name="subscriptionStatus" defaultValue={u.subscriptionStatus}>
                  {Object.entries(SUB_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label>Abo läuft bis</label><input className="input" type="date" name="subscriptionEndsAt" defaultValue={u.subscriptionEndsAt?.toISOString().slice(0, 10) ?? ""} /></div>
            <div className="field"><label>Interne Notiz (nur Admins)</label><textarea className="textarea" name="adminNote" style={{ minHeight: 70 }} defaultValue={u.adminNote ?? ""} /></div>
            <p className="small muted">Abo-Daten pflegst du hier von Hand, bis Stripe angebunden ist.</p>
          </AdminForm>
        </section>

        <section className="card card-pad">
          <div className="card-head"><h2>Zugang & Sicherheit</h2></div>
          <dl className="kv" style={{ marginBottom: 16 }}>
            <dt>Letzte Anmeldung</dt><dd>{fmt(u.lastLoginAt)}</dd>
            <dt>Passwort</dt><dd>{u.passwordHash ? (u.mustChangePassword ? "vorläufig – muss geändert werden" : "gesetzt") : "keins (nur Google)"}</dd>
            <dt>Zwei-Faktor</dt><dd>{TWOFA_LABEL[u.twoFactorMethod]}{u.phone ? ` (${u.phone})` : ""}</dd>
            <dt>Aktive Sitzungen</dt><dd>{sessions?.n ?? 0}</dd>
          </dl>
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>Neues Passwort vergeben</h3>
          <AdminForm action={setPasswordAction} submit="Passwort setzen" inline>
            <input type="hidden" name="userId" value={u.id} />
            <input className="input" name="password" placeholder="leer lassen = generieren" style={{ flex: 1, minWidth: 180 }} />
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="mustChange" value="on" defaultChecked /> beim Login ändern
            </label>
          </AdminForm>
          <div className="toolbar" style={{ marginTop: 14 }}>
            {channels.email && (
              <AdminForm action={sendResetLinkAction} submit="Reset-Link senden">
                <input type="hidden" name="userId" value={u.id} />
              </AdminForm>
            )}
            <ActionButton action={logoutUserAction.bind(null, u.id)} confirm="Alle Sitzungen dieses Kunden beenden?">Überall abmelden</ActionButton>
            {u.twoFactorMethod !== "none" && (
              <ActionButton action={resetTwoFactorAction.bind(null, u.id)} confirm="Zwei-Faktor-Anmeldung zurücksetzen? Nur tun, wenn die Identität geprüft ist.">2FA zurücksetzen</ActionButton>
            )}
            {locked && <ActionButton action={unlockAction.bind(null, u.id)}>Login entsperren</ActionButton>}
            {!self && (u.status === "active" ? (
              <ActionButton className="btn btn-sm btn-danger" action={setStatusAction.bind(null, u.id, "disabled")} confirm="Konto sperren? Der Kunde wird sofort abgemeldet.">Konto sperren</ActionButton>
            ) : (
              <ActionButton action={setStatusAction.bind(null, u.id, "active")}>Konto entsperren</ActionButton>
            ))}
            {u.role === "admin" ? (
              <ActionButton action={setRoleAction.bind(null, u.id, "user")} confirm="Admin-Rechte entziehen?">Admin-Rechte entziehen</ActionButton>
            ) : (
              <ActionButton action={setRoleAction.bind(null, u.id, "admin")} confirm="Diesem Konto volle Admin-Rechte geben?">Zum Admin machen</ActionButton>
            )}
          </div>
        </section>
      </div>

      <div className="split" style={{ alignItems: "start" }}>
        <section className="card card-pad">
          <div className="card-head"><h2>Funktionen</h2></div>
          {(Object.keys(FEATURES) as FeatureKey[]).map((key) => {
            const on = hasFeature(u, key);
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--mw-line-soft)" }}>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13 }}>{FEATURES[key].label}</b>
                  <div className="small muted">{FEATURES[key].description}</div>
                </div>
                <ActionButton className={`btn btn-sm ${on ? "" : "btn-primary"}`} action={setFeatureAction.bind(null, u.id, key, !on)}>
                  {on ? "Ausschalten" : "Einschalten"}
                </ActionButton>
              </div>
            );
          })}
        </section>

        <section className="card card-pad">
          <div className="card-head"><h2>Nutzung</h2></div>
          <dl className="kv">
            <dt>Marvin diesen Monat</dt><dd>{usageMonth?.calls ?? 0} Aufrufe · {formatUsd(usageMonth?.cost ?? 0)}</dd>
            <dt>Marvin gesamt</dt><dd>{usageTotal?.calls ?? 0} Aufrufe · {formatUsd(usageTotal?.cost ?? 0)}</dd>
            <dt>Synchronisierte E-Mails</dt><dd>{counts?.emails ?? 0}</dd>
            <dt>Über Freigabe gesendet</dt><dd>{counts?.sent ?? 0}</dd>
            <dt>Projekte / Aufgaben</dt><dd>{counts?.projects ?? 0} / {counts?.tasks ?? 0}</dd>
          </dl>
        </section>
      </div>

      <section className="card card-pad">
        <div className="card-head"><h2>Postfächer</h2></div>
        {accounts.length ? (
          <table className="table">
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.emailAddress}</b><div className="small muted">{a.provider} · Stufe {a.permissionLevel}</div></td>
                  <td><span className={`badge ${a.status === "active" ? "badge-green" : "badge-red"}`}>{a.status}</span>{a.lastError && <div className="small" style={{ color: "var(--mw-red-500)" }}>{a.lastError}</div>}</td>
                  <td className="small muted">Sync: {fmt(a.lastSyncedAt)}</td>
                  <td style={{ textAlign: "right" }}><ActionButton action={resyncAccountAction.bind(null, a.id)}><Icon name="refresh" size={14} /> Neu synchronisieren</ActionButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">Noch kein Postfach verbunden.</p>
        )}
      </section>

      <div className="split" style={{ alignItems: "start" }}>
        <section className="card card-pad">
          <div className="card-head"><h2>Support-Notizen</h2></div>
          <AdminForm action={addSupportNoteAction} submit="Notiz hinzufügen">
            <input type="hidden" name="userId" value={u.id} />
            <textarea className="textarea" name="body" style={{ minHeight: 70, marginBottom: 8 }} placeholder="z. B. Anruf am …, Problem mit …" />
          </AdminForm>
          <div style={{ marginTop: 12 }}>
            {notes.map(({ note, author }) => (
              <div key={note.id} style={{ padding: "10px 0", borderTop: "1px solid var(--mw-line-soft)" }}>
                <div className="small muted">{fmt(note.createdAt)} · {author ?? "gelöschter Admin"}</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{note.body}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="card card-pad">
          <div className="card-head">
            <h2>Aktivitäten</h2>
          </div>
          <table className="table">
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmt(l.createdAt)}</td>
                  <td className="small">{l.actor}</td>
                  <td className="small">{l.action}</td>
                  <td><span className={`badge ${l.status === "success" ? "badge-green" : "badge-red"}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card card-pad">
        <div className="card-head"><h2>Daten (DSGVO)</h2></div>
        <div className="split" style={{ alignItems: "start" }}>
          <div>
            <p className="small muted">Auskunft nach Art. 15/20 DSGVO: alle gespeicherten Daten als JSON-Datei (ohne Zugangstoken).</p>
            <a className="btn btn-sm" href={`/api/admin/export/${u.id}`}>Datenexport herunterladen</a>
          </div>
          {!self && (
            <div>
              <p className="small muted">Löschen nach Art. 17 DSGVO: Konto, E-Mails, Projekte, Verlauf – endgültig. Google-Zugriffe werden widerrufen.</p>
              <AdminForm action={deleteUserAction} submit="Endgültig löschen" danger inline>
                <input type="hidden" name="userId" value={u.id} />
                <input className="input" name="confirm" placeholder={`zur Bestätigung: ${u.email}`} style={{ flex: 1, minWidth: 220 }} />
              </AdminForm>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
