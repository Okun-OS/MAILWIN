import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { connectorFor, lookupThread, threadCounterpart } from "@/lib/crm/service";
import type { CrmPipeline } from "@/lib/crm/types";
import { CrmLinkButton } from "./CrmLinkButton";
import { CrmLeadForm, type StageOption } from "./CrmLeadForm";
import { Icon } from "./Icon";

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "offen", cls: "badge-blue" },
  won: { label: "gewonnen", cls: "badge-green" },
  lost: { label: "verloren", cls: "badge-red" },
};

function Shell({ children, end }: { children: React.ReactNode; end?: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ marginBottom: 16 }} id="crm">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <span className="head-icon"><Icon name="briefcase" /></span>
        <div><h2>OKUN CRM</h2></div>
        {end && <div className="end">{end}</div>}
      </div>
      {children}
    </section>
  );
}

const SIGNAL_LABEL: Record<string, string> = {
  offer_sent: "Angebot verschickt",
  offer_accepted: "Angebot angenommen",
  offer_declined: "Absage",
  meeting_requested: "Terminwunsch",
  meeting_booked: "Termin bestätigt",
  question: "Rückfrage",
  out_of_office: "Abwesenheitsnotiz",
  contract_sent: "Vertrag verschickt",
  contract_accepted: "Vertrag unterschrieben",
  task: "Aufgabe",
  contact_details: "Kontaktdaten",
};

const APPLIED_LABEL: Record<string, string> = {
  value_updated: "Wert übernommen",
  offer_follow_up: "Nachfassen geplant",
  meeting_created: "Termin eingetragen",
  next_action_set: "nächster Schritt gesetzt",
  automation_paused: "Nachfassen pausiert",
  won: "gewonnen",
  lost: "verloren",
  task_created: "Aufgabe angelegt",
  task_exists: "Aufgabe gab es schon",
};

function appliedText(applied: string[]) {
  return applied
    .filter((a) => a !== "timeline")
    .map((a) => (a.startsWith("stage_changed:") ? `Phase → ${a.slice(14)}` : a.startsWith("filled:") ? `${a.slice(7)} ergänzt` : (APPLIED_LABEL[a] ?? a)))
    .join(", ");
}

/** Was Mailwin aus den Nachrichten erkannt und dem CRM gemeldet hat – mit der Antwort des CRM. */
async function SignalList({ threadId, integrationId, timezone }: { threadId: string; integrationId: string; timezone: string }) {
  const rows = await db
    .select()
    .from(schema.crmSignals)
    .where(and(eq(schema.crmSignals.threadId, threadId), eq(schema.crmSignals.integrationId, integrationId)))
    .orderBy(desc(schema.crmSignals.createdAt))
    .limit(5);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>Erkannt und ans CRM gemeldet</div>
      <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
        {rows.map((r) => {
          const result = r.error
            ? `nicht übernommen (${r.error})`
            : !r.sentAt
              ? "wird gemeldet …"
              : [
                  appliedText(r.applied),
                  ...r.proposals.map((p) => `Vorschlag „${p.title}“${p.accepted === true ? " übernommen" : p.accepted === false ? " verworfen" : " wartet im CRM"}`),
                  r.nextActionTitle ? `nächster Schritt: ${r.nextActionTitle}${r.nextActionDueAt ? ` am ${r.nextActionDueAt.toLocaleDateString("de-DE", { timeZone: timezone })}` : ""}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "im CRM vermerkt";
          return (
            <li key={r.id} title={r.quote ?? undefined}>
              <b>{SIGNAL_LABEL[r.signal] ?? r.signal}</b>
              {r.confidence != null && r.signal !== "out_of_office" ? <span className="muted"> ({Math.round(r.confidence * 100)} %)</span> : null} – {result}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** CRM-Karte einer Konversation: Kontakt, offene Leads, Zuordnung, „Als Lead anlegen“. */
export async function CrmCard({ userId, threadId, subject, timezone = "Europe/Berlin" }: { userId: string; threadId: string; subject: string | null; timezone?: string }) {
  let view: Awaited<ReturnType<typeof lookupThread>>;
  try {
    view = await lookupThread(userId, threadId);
  } catch {
    return null;
  }
  if (!view) return null;
  const { integration, link, person, contact, error } = view;
  const openInCrm = (url: string | null | undefined, label = "Im CRM öffnen") =>
    url ? <a className="link-more" href={url} target="_blank" rel="noreferrer">{label} <Icon name="arrowRight" size={14} /></a> : null;

  if (integration.status !== "active") {
    return (
      <Shell>
        <p className="small muted" style={{ margin: 0 }}>
          Die Verbindung zum CRM ist unterbrochen. <Link href="/einstellungen#integrationen" className="link-more">In den Einstellungen prüfen</Link>
        </p>
      </Shell>
    );
  }

  // Zugeordnet zu einem Lead
  if (link?.leadId) {
    const status = STATUS[link.leadStatus ?? "open"] ?? STATUS.open!;
    return (
      <Shell end={openInCrm(link.leadUrl)}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b>{link.leadTitle ?? "Lead"}</b>
          {/* Phase in der Farbe des Status: offen blau, gewonnen grün, verloren rot */}
          <span className={`badge ${status.cls}`} title={`Status: ${status.label}`}>{link.leadStage ?? status.label}</span>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          {link.contactName ?? person?.email}
          {contact?.company ? ` · ${contact.company.name}` : ""} ·{" "}
          {integration.settings.logMode === "off" ? "Nachrichten werden nicht übertragen" : "Nachrichten dieser Konversation werden am Lead protokolliert"}
          {link.linkedBy === "auto" ? " · automatisch zugeordnet" : link.linkedBy === "marvin" ? " · von Marvin zugeordnet" : ""}
        </p>
        {link.nextActionTitle && link.leadStatus !== "won" && link.leadStatus !== "lost" && (
          <p className="small" style={{ margin: "8px 0 0" }}>
            Nächster Schritt im CRM: <b>{link.nextActionTitle}</b>
            {link.nextActionDueAt ? ` · fällig ${link.nextActionDueAt.toLocaleDateString("de-DE", { timeZone: timezone, dateStyle: "medium" })}` : ""}
          </p>
        )}
        <SignalList threadId={threadId} integrationId={integration.id} timezone={timezone} />
        <div style={{ marginTop: 10 }}>
          <CrmLinkButton threadId={threadId} op="unlink" confirm="Zuordnung lösen? Bereits übertragene Nachrichten bleiben im CRM." className="btn btn-sm btn-ghost">
            Zuordnung lösen
          </CrmLinkButton>
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="small muted" style={{ margin: 0 }}>Das CRM ist gerade nicht erreichbar: {error}</p>
      </Shell>
    );
  }
  if (!person) return null;

  let pipelines: CrmPipeline[] = [];
  try {
    pipelines = await connectorFor(integration).pipelines();
  } catch {
    // Ohne Pipelines geht es mit der Standard-Phase weiter
  }
  const stages: StageOption[] = pipelines.flatMap((p) =>
    [...p.stages]
      .filter((s) => !s.type || s.type === "open")
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ value: `${p.id}|${s.id}`, label: s.name, group: p.name })),
  );
  const { latestInbound } = await threadCounterpart(threadId);
  const description = (latestInbound?.bodyText ?? latestInbound?.snippet ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
  const leadForm = (
    <CrmLeadForm
      threadId={threadId}
      title={(subject ?? "").replace(/^((re|aw|fwd?|wg):\s*)+/i, "").slice(0, 160) || "Neue Anfrage"}
      description={description}
      companyName={contact?.company?.name ?? ""}
      stages={stages}
    />
  );

  return (
    <Shell end={contact ? openInCrm(contact.url, "Kontakt im CRM") : null}>
      {contact ? (
        <>
          <p style={{ margin: 0 }}>
            <b>{contact.name}</b>
            {contact.company ? ` · ${contact.company.name}` : ""} <span className="small muted">{contact.email}</span>
          </p>
          {link && !link.leadId && <p className="small muted" style={{ margin: "4px 0 0" }}>Dem Kontakt zugeordnet – noch keinem Lead.</p>}
          {contact.openLeads.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>Offene Leads – gehört diese Konversation dazu?</div>
              <div className="stack" style={{ gap: 8 }}>
                {contact.openLeads.map((l) => (
                  <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {l.title} <span className="badge">{l.stage}</span>
                    </span>
                    <CrmLinkButton threadId={threadId} leadId={l.id}>
                      <Icon name="link" size={14} /> Diesem Lead zuordnen
                    </CrmLinkButton>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="small muted" style={{ margin: "8px 0 0" }}>Keine offenen Leads.</p>
          )}
          {!link && (
            <div style={{ marginTop: 10 }}>
              <CrmLinkButton threadId={threadId} className="btn btn-sm btn-ghost">
                Nur dem Kontakt zuordnen
              </CrmLinkButton>
            </div>
          )}
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{person.name ? `${person.name} (${person.email})` : person.email} ist noch nicht im CRM.</p>
      )}
      <details style={{ marginTop: 12 }}>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
          <Icon name="plus" size={13} /> Als {contact?.openLeads.length ? "neuen " : ""}Lead anlegen
        </summary>
        <div style={{ marginTop: 12 }}>{leadForm}</div>
      </details>
    </Shell>
  );
}
