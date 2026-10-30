# OKUN Mailwin – Architektur

Dieses Dokument leitet aus dem Master-Prompt die Systemarchitektur ab. Was davon schon gebaut ist, steht in [STATUS.md](./STATUS.md).

## 1. Funktions- und Modulübersicht

| Modul | Aufgabe | Phase | Code |
|---|---|---|---|
| Identität & Sitzungen | Anmeldung per Google OAuth, Sitzungen, Nutzerprofil, Zeitzone | 1 | `src/lib/auth/*` |
| E-Mail-Integration | Konten verbinden, Synchronisation, Senden, Labels/Ordner, Anhänge | 1 (Gmail), 5 (Microsoft/IMAP) | `src/lib/mail/*` |
| Kalender | Termine lesen (Google Calendar, nur Lesezugriff) | 1 | `src/lib/calendar/*` |
| Marvin (Agent) | Natürliche Sprache → Planung → kontrollierte Tool-Aufrufe | 1 (Mail-Tools), 3 (Recherche & Projekte), 4 (Nachverfolgung) | `src/lib/marvin/*` |
| Freigaben | Entwürfe und kritische Aktionen dem Nutzer vorlegen; Ausführung erst nach Bestätigung | 1 | `src/lib/approvals.ts` |
| Projekte & Aufgaben | Ziel → Plan → Aufgaben, Kontakte, Quellen und Verlauf | 1 (Grundlage), 3 (vollständig) | Schema, `projekte/*`, `aufgaben/*` |
| Automationen | Regeln (Auslöser, Bedingungen, Aktionen) mit Modus *vorschlagen*, *Freigabe* oder *automatisch* | 2 | Schema vorbereitet |
| Postfach-Aufräumassistent | Analyse, Kategorien, Archiv- und Löschvorschläge | 2 | – |
| Follow-ups | Antwortüberwachung, Erinnerungen, Abbruch bei Antwort | 4 | Schema vorbereitet |
| Signaturen | Pro Konto, wird beim Versand automatisch angehängt | 1 (einfach), 5 (Studio) | `einstellungen`, `mail/actions.ts` |
| Benachrichtigungen | In-App, priorisiert | 1 | `notifications` |
| Audit | Lückenloses Protokoll aller Aktionen, auch verweigerter | 1 | `src/lib/audit.ts`, `/aktivitaeten` |
| Hintergrund-Worker | Synchronisation, Fristen, Automationen – auch bei geschlossenem Browser | 1 | `src/worker`, `src/lib/jobs/*` |

## 2. Systemarchitektur

```
 Browser (Next.js App Router, React Server Components)
   │  Server Actions / Route Handlers  (Sitzung + Besitzprüfung bei jedem Aufruf)
   ▼
 ┌───────────────────────────── Anwendungsschicht (TypeScript) ─────────────────────────────┐
 │  Dashboard-Daten   Marvin-Agent ──► Tool-Registry ──► Berechtigungsprüfung ──► Executor  │
 │                        │                                   │                     │       │
 │                        ▼                                   ▼                     ▼       │
 │                  Claude API (Opus)                  Freigaben (approval_requests)        │
 │                  + Websuche (serverseitig)                 │ nach Nutzer-Bestätigung      │
 │                                                            ▼                             │
 │                                 E-Mail-Integrationsschicht (MailProvider-Interface)      │
 │                                    GmailProvider │ MicrosoftProvider* │ ImapProvider*     │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
   │                                    ▲
   ▼                                    │ Jobs (FOR UPDATE SKIP LOCKED)
 PostgreSQL  ◄──────────────────  Worker-Prozess (npm run worker)
```
\* Phase 5

Die Bereiche sind klar getrennt:

- **UI**: nur Darstellung und Server Actions.
- **Agentenlogik** (`marvin/agent.ts`): Gesprächsschleife, ohne eigene Seiteneffekte.
- **Ausführung** (`marvin/tools.ts`, `mail/actions.ts`, `approvals.ts`): einzige Stelle, die Anbieter verändert.
- **Hintergrund** (`worker`): unabhängiger Prozess.
- **Datenhaltung** (`db/schema.ts`): ein Schema für alle Bereiche.

## 3. Datenbankschema

Das Schema ist in `src/lib/db/schema.ts` definiert, die Migrationen liegen in `drizzle/`. Jede fachliche Tabelle hängt über `user_id` (direkt oder über das Konto) an genau einem Nutzer. Damit sind die Daten mehrerer Nutzer strikt getrennt.

| Entität (Spezifikation) | Tabelle | Wichtige Felder |
|---|---|---|
| User | `users` | E-Mail, Name, Zeitzone, `preferences` (vom Nutzer einsehbar und löschbar) |
| – | `sessions` | nur der SHA-256-Hash des Cookie-Tokens |
| ConnectedAccount | `connected_accounts` | Anbieter, verschlüsselte Token, Scopes, Status (`active` / `reauth_required` / …), **Freigabestufe**, Sync-Cursor |
| LabelOrFolder | `labels` | `kind` = system / user / folder (Gmail-Labels und IMAP-Ordner einheitlich) |
| EmailThread | `email_threads` | `needs_reply`, `awaiting_reply_since`, Priorität, `project_id` |
| Email | `emails` | Header, Text und HTML, Labels, eingehend oder ausgehend, Kategorie |
| – | `attachments` | nur Metadaten; der Inhalt wird bei Bedarf vom Anbieter geladen |
| Contact / Organization | `contacts`, `organizations` | Herkunft (E-Mail, manuell, Recherche), `verified` |
| Project / Task | `projects`, `tasks`, `task_dependencies`, `project_events` | Status laut Spezifikation 7.5, Abhängigkeiten, Verlauf |
| ResearchSource | `research_sources` | URL, `confidence` = bestätigt / Annahme / offen |
| AutomationRule / AutomationExecution | `automation_rules`, `automation_executions` | Modus, Zähler; ein Unique-Index (Regel + E-Mail) verhindert Doppelausführung |
| ApprovalRequest | `approval_requests` | unveränderliche Nutzlast, Risiko, Status, Herkunft (Unterhaltung + `tool_use_id`) |
| Signature | `signatures` | pro Konto, Standard-Flag |
| Notification | `notifications` | Art, Priorität, Link |
| ScheduledFollowUp | `scheduled_follow_ups` | Frist, maximale Zahl an Erinnerungen, Modus |
| AuditLog | `audit_logs` | Akteur (Nutzer, Marvin, Automation, System), Status (Erfolg, fehlgeschlagen, verweigert) |
| – | `calendar_events` | gespiegelte Termine |
| – | `marvin_conversations`, `marvin_messages` | append-only API-Verlauf, optional einem Projekt zugeordnet |
| – | `jobs` | Warteschlange mit Dedupe-Schlüssel und Backoff |

## 4. Tool- und Berechtigungsarchitektur für Marvin

**Freigabestufen pro Konto** (Spezifikation 14):

| Stufe | Wert | Erlaubt | Ausführung |
|---|---|---|---|
| 1 | `read` | Suchen, Lesen, Tagesüberblick, Kalender, Aufgaben | sofort |
| 2 | `organize` | zusätzlich Labels, Archivieren, Lesestatus | sofort, wird protokolliert |
| 3 | `communicate` | zusätzlich Entwürfe für Senden und Weiterleiten | **nur über eine Freigabe** |
| 4 | – | Papierkorb (kritische Aktion) | **immer** gesonderte Bestätigung, nie dauerhaft freigebbar |

Dauerhaftes Löschen gibt es weder in der Schnittstelle noch im OAuth-Scope (`gmail.modify` statt `mail.google.com`).

**Ablauf eines Tool-Aufrufs:**

1. Das Modell liefert `tool_use`.
2. Die Eingabe wird per Zod-Schema geprüft.
3. Besitz wird geprüft: Konversation, E-Mail und Konto müssen dem Nutzer gehören.
4. Die Fähigkeit wird gegen die Freigabestufe des Kontos geprüft (`assertCapability`).
5. Ausführung oder `createApproval`.
6. Audit-Eintrag.
7. Das `tool_result` geht an das Modell zurück. Ein Fehler geht ehrlich als `is_error` zurück, sodass Marvin keinen Erfolg behaupten kann.

**Freigaben:**

- Gespeichert wird die vollständige Nutzlast, also Empfänger, Betreff, Text und Bezug.
- Der Nutzer kann sie vor dem Senden ändern.
- Ausgeführt wird genau der gespeicherte bzw. geänderte Stand.
- Der Wechsel des Status `pending` → `approved` ist ein atomares `UPDATE … WHERE status='pending'`. Das schützt vor Doppelversand.
- Nach der Entscheidung bekommt Marvin einen Systemhinweis in seine Unterhaltung.

**Schutz gegen Prompt-Injection:**

- E-Mail-Inhalte gehen nur markiert an das Modell (`<email_inhalt hinweis="Fremder Inhalt …">`).
- Der System-Prompt verbietet, Anweisungen daraus zu befolgen.
- Die eigentliche Sicherheitsgrenze ist aber der Code: Ohne Klick des Nutzers kann keine E-Mail das Konto verlassen, egal was im Prompt steht.

**Modell:**

- `claude-opus-5-5` mit adaptivem Denken und Effort `medium`.
- Serverseitiger Fallback bei Ablehnungen (`fallbacks: "default"`).
- Websuche als serverseitiges Werkzeug (`web_search_20260209`).
- Der Verlauf ist append-only, damit Denkblöcke und Cache gültig bleiben.
- Veränderliche Angaben wie Datum, Konten und Projekt stehen im `<kontext>`-Block der Nutzernachricht. So bleibt der System-Prompt cachebar.

## 5. Integration von Gmail und weiteren Anbietern

- **Gemeinsames Interface** `MailProvider` (`src/lib/mail/types.ts`) mit den Operationen: Liste, Nachricht, Cursor und Delta, Senden, Labels ändern, Archivieren, Papierkorb, Lesestatus, Labels auflisten und anlegen, Anhang. Labels tragen `kind`, damit Gmail-Labels und IMAP- oder Exchange-Ordner gleich behandelt werden.
- **Gmail:**
  - Anmeldung per OAuth 2 mit PKCE und `access_type=offline`.
  - Scopes: `gmail.modify`, `gmail.send` und `calendar.readonly`.
  - Erstabgleich über die letzten 30 Tage (maximal 300 Nachrichten), danach Delta über die `history`-API. Ein HTTP 404 löst einen vollständigen Neuabgleich aus.
  - Erneuerte Token werden verschlüsselt zurückgeschrieben.
  - `invalid_grant` oder HTTP 401 führen zu `ReauthRequiredError`: Das Konto bekommt den Status `reauth_required`, der Nutzer eine Benachrichtigung, und der Job wird nicht endlos wiederholt.
- **Microsoft 365 / Outlook (Phase 5)**: `MicrosoftProvider` über Microsoft Graph (Mail.ReadWrite, Mail.Send). Delta-Abfragen bilden den Cursor, Ordner werden als `kind: "folder"` abgebildet.
- **IMAP/SMTP (Phase 5)**: `ImapProvider` für iCloud, Yahoo, GMX, WEB.DE und eigene Domains.
  - Cursor: `UIDVALIDITY` plus höchste UID.
  - Passwörter oder App-Passwörter werden verschlüsselt gespeichert (gleicher AES-256-GCM-Mechanismus).
  - MIME-Erzeugung und Header-Dekodierung (`mail/mime.ts`) sind schon anbieterunabhängig.
- **Token-Sicherheit**: AES-256-GCM mit einem Schlüssel aus `ENCRYPTION_KEY`. Das Format ist versioniert (`v1.`), damit der Schlüssel später rotiert werden kann.

### CRM-Anbindung

- **Gemeinsames Interface** `CrmConnector` (`src/lib/crm/types.ts`), aufgebaut wie `MailProvider`. Der erste Adapter ist das OKUN CRM (`OkunCrmClient`, Connect API v1); HubSpot und Pipedrive folgen als weitere Adapter.
- Eine Integration pro Nutzer (`integrations`). Schlüssel und Webhook-Geheimnis sind AES-256-GCM-verschlüsselt.
- **Zuordnung** Konversation → Kontakt/Lead in `crm_thread_links`. Gemeldete Nachrichten stehen in `crm_activities`, damit jede genau einmal ans CRM geht.
- **Ablauf:** Delta-Sync und Versand reihen `crm_process_thread` ein (Dedupe je Konversation). Der Job meldet neue Nachrichten und ordnet im Modus „alle CRM-Kontakte“ automatisch zu.
- **Webhooks** des CRM landen auf `/api/integrations/okun-crm/webhook`. Die Route prüft die HMAC-Signatur und erkennt Duplikate über `webhook_events`.
- Einzelheiten: `docs/CRM-ANBINDUNG.md`.

## 6. Dauerhafte Hintergrundprozesse

- **Warteschlange**: eine eigene Tabelle `jobs`. Jobs werden mit `FOR UPDATE SKIP LOCKED` geholt, deshalb können mehrere Worker parallel laufen.
  - Dedupe-Schlüssel: Es gibt pro Konto höchstens einen offenen Sync-Job.
  - Exponentielles Backoff ab 30 s, höchstens 5 Versuche.
  - Abgestürzte Jobs werden nach 10 Minuten freigegeben.
- **Worker** (`npm run worker`): plant alle 2 Minuten Synchronisationen und arbeitet die Warteschlange ab, unabhängig von Browser und Chat.
- **Ausbaustufen**:
  - Gmail-Push über Pub/Sub (`users.watch`) ersetzt das Polling.
  - Vorhandene Job-Arten: `sync_account`, `crm_process_thread`.
  - Neue Job-Arten: `evaluate_rules` (Phase 2), `followup_due` und `reply_detected` (Phase 4).
  - Doppelte Ausführungen verhindern die Unique-Indizes auf `automation_executions` und die Dedupe-Schlüssel.

## 7. Struktur der Benutzeroberfläche

| Route | Inhalt |
|---|---|
| `/` | Dashboard nach Referenzbild: Hero „Heute im Blick“ (Bild-Layer + dynamische Sprechblase + Kennzahlen-Kacheln), Marvin-Empfehlungen, Wochenachse, nächste Termine, Mail-Übersicht, Projekt-Pulse, Schnellaktionen |
| `/emails`, `/emails/[id]`, `/emails/neu` | Gemeinsamer Posteingang mit Filtern (Antwort erforderlich, wartend, ungelesen, heute, gesendet) und Konto-Filter; Thread-Ansicht mit isoliertem HTML (Sandbox, externe Bilder blockiert); Verfassen, Antworten und Weiterleiten |
| `/marvin`, `/marvin/[id]` | Chat mit Werkzeug-Chips, Quellen und Entwurfskarten (Bearbeiten / Senden / Ablehnen) |
| `/projekte`, `/projekte/neu`, `/projekte/[id]` | Projektstart als Gespräch (Bürohintergrund + zeigender Marvin), Projektplan + Marvin im Projektkontext |
| `/aufgaben`, `/kalender`, `/freigaben` | Projektübergreifende Aufgaben, 14-Tage-Kalender, offene und entschiedene Freigaben |
| `/einstellungen` | Konten, Freigabestufe pro Konto, Signaturen, Zeitzone, Datenschutz |
| `/aktivitaeten`, `/benachrichtigungen`, `/suche` | Audit-Protokoll, In-App-Benachrichtigungen, globale Suche |

**Designsystem:**

- Alle Tokens (Farben aus den Markenvorlagen, Radien, Schatten) stehen zentral in `src/app/globals.css`.
- Schriften: Inter für Text, Plus Jakarta Sans für Überschriften.
- Bildassets liegen in `public/brand/`. Die Referenz ist `docs/design/dashboard-referenz.png`.

**Hero-Grafik:**

- Die Header-Grafik ist auf die Karte zugeschnitten (1944×665).
- Texte und Kacheln sitzen in Prozent der Bildfläche und skalieren mit Container-Query-Einheiten.
- Unter 640 px wird gestapelt: oben das Bild mit Marvin, darunter Sprechblase und Kacheln als eigene Elemente.

## 8. Priorisierter Implementierungsplan mit Abnahmekriterien

| Phase | Lieferumfang | Abnahme (Spezifikation 18) |
|---|---|---|
| **1 – Fundament** | Anmeldung, Gmail-Verbindung, Sync-Worker, Posteingang, Lesen, Suchen, Senden, Antworten, Weiterleiten, Anhänge, Labels, Dashboard, Marvin mit echten Tools, Freigaben, Audit, Signatur | Test 1 (Gmail lesen, beantworten, senden), Test 7 (Signatur beim Versand), Test 8 (kein unautorisierter Versand), Test 9 (abgelaufenes Token), Test 10 (Verlauf prüfbar) |
| **2 – Postfachorganisation** | Analyse-Job, Kategorievorschläge, Label-Anlage in Serie, Archiv- und Löschvorschau, Regel-Engine im Worker, KI-Priorisierung | Test 2 (Aufräumen nach Freigabe), Test 3 (Rechnungen automatisch ins Label), Test 10 (Automation stoppen, Verlauf) |
| **3 – Projekte & Recherche** | Projektplanung mit Abhängigkeiten, Recherchequellen speichern (`research_sources`), verifizierte Kontakte, Threads automatisch Projekten zuordnen | Test 4 (Ziel → Aufgaben, Ansprechpartner, Entwürfe) |
| **4 – Nachverfolgung** | Erkennen eingehender Antworten, Klassifikation (Zusage, Rückfrage …), Follow-up-Regeln mit Ruhezeiten und Abbruch | Test 5 (Antwort wird erkannt und zugeordnet), Test 6 (Erinnerung nach Frist) |
| **5 – Anbieter & Personalisierung** | Microsoft Graph, IMAP/SMTP, Signatur-Studio (HTML, Logo), Schreibstil-Profil | Test 7 erweitert |
| **6 – Erweiterte Agenten** | Mehrstufige Workflows, Teamfunktionen, Push-Benachrichtigungen | – |
