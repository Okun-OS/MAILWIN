# CRM-Anbindung: OKUN CRM (Mailwin-Seite)

Status: **umgesetzt bis Connect API v1.3** (Signale, Aufgaben, Kontaktdaten, Lead-Details, Nachfassen). Getestet gegen einen Nachbau der API nach `openapi.json` 1.3.0. Der Test gegen die echte Testinstanz des CRM steht noch aus (siehe unten).

Mailwin nutzt die „Mailwin Connect API“ des OKUN CRM. Die Spezifikation liegt im CRM-Repository unter `docs/mailwin/UEBERGABE-MAILWIN.md` und `openapi.json`. Begriff: Ein Mailwin-„Lead“ ist im CRM ein **Deal**.

---

## Einrichten (für Kunden)

1. **Im CRM:** Einstellungen → Integrationen → Mailwin → „Schlüssel erzeugen“. Den Schlüssel (`okun_mw_…`) kopieren; er wird dort nur einmal angezeigt.
2. **In Mailwin:** Einstellungen → **CRM-Anbindung**. Die Adresse des CRM eintragen, also die Adresse, unter der man das CRM im Browser öffnet, und den Schlüssel einfügen. Dann „CRM verbinden“ klicken. Mailwin prüft den Schlüssel sofort und zeigt den Namen des Arbeitsbereichs.
3. **Rückmeldungen (optional, empfohlen):** In Mailwin unter „Rückmeldungen vom CRM (Webhook)“ die Webhook-Adresse kopieren. Für das Geheimnis gibt es zwei Wege:
   - Mailwin erzeugt es („Hier erzeugen“, nur einmal sichtbar). Dann beides im CRM eintragen.
   - Das CRM erzeugt es. Dann das Geheimnis in Mailwin einfügen.

Der Admin kann die Funktion je Kunde abschalten (Feature-Schalter „CRM-Anbindung“).

## Einstellungen

| Einstellung | Werte | Standard |
|---|---|---|
| **Nachrichten ins CRM übertragen** | *Nur zugeordnete Konversationen* · *Zusätzlich alle Konversationen mit CRM-Kontakten automatisch zuordnen* · *Keine Nachrichten übertragen* | nur zugeordnete |
| **Inhalt der Nachrichten** | Betreff + Anfang (ca. 500 Zeichen) · vollständiger Text | Vorschau (Datensparsamkeit) |
| **Leads durch Marvin** | immer erst fragen (Freigabe) · direkt anlegen | Freigabe |
| **Signale erkennen und ans CRM melden** | an · aus | an |

## Abläufe

| Ablauf | Auslöser in Mailwin | Aufrufe ans CRM |
|---|---|---|
| **A – neue Anfrage** | „Als Lead anlegen“ auf der Konversation oder Marvin (`crm_create_lead`) | `POST /leads` (legt Kontakt/Firma bei Bedarf an) → `GET /contacts` (Kontakt-ID, Phase) → `POST /activities` je Nachricht mit `leadId` |
| **B – Bestandskunde** | „Diesem Lead zuordnen“ / „Nur dem Kontakt zuordnen“, Marvin (`crm_link_thread`) oder automatisch | `GET /contacts` → `POST /activities` mit `leadId` + `contactId` |
| **C – wir schreiben** | Versand aus Mailwin oder neue Nachricht im Ordner „Gesendet“ | `POST /activities` mit `direction: "outbound"` |
| **D – Rückmeldungen** | Webhook des CRM | `lead.stage_changed`, `lead.won`, `lead.lost`, `lead.deleted`, `lead.next_action_changed`, `lead.next_action_due`, `contact.updated`, `contact.merged`, `signal.proposal_resolved`, `ping` |

Einzelheiten:
- **Neue Nachrichten** werden nach jedem Abruf (alle 2 Minuten) im Hintergrund gemeldet: Job `crm_process_thread`, einer pro Konversation.
  - Der **Erstabruf** alter E-Mails löst nichts aus.
  - Jede Nachricht wird **genau einmal** gemeldet: Tabelle `crm_activities` und `externalId = email:<id>`.
- **Automatische Zuordnung** (nur im Modus „alle CRM-Kontakte“):
  - Hat der Kontakt **genau einen** offenen Lead, ordnet Mailwin die Konversation diesem zu.
  - Sonst nur dem Kontakt. Der Nutzer wählt den Lead dann auf der Konversation.
- **Abwesenheitsnotizen** (Betreff „Automatische Antwort“, „Out of Office“ …) gehen nur an den Kontakt, nie an den Lead, sonst würden sie im CRM als Kundenantwort zählen und das Nachfassen stoppen. **Unzustellbar-Meldungen** werden gar nicht übertragen.
- **Gewonnen/verloren** (Webhook):
  - Mailwin zeigt den Status auf der Konversation und benachrichtigt den Nutzer.
  - Geplante Nachfass-Erinnerungen in Mailwin werden beendet.
  - Verspätet zugestellte ältere Ereignisse überschreiben keine neuere Phase.
- **Lead im CRM gelöscht** (`lead.deleted` oder 404 beim Melden): Die Konversation bleibt dem Kontakt zugeordnet. Offene Meldungen zu diesem Lead verwirft Mailwin, und der Nutzer bekommt eine Benachrichtigung.
- **Kontakte zusammengeführt** (`contact.merged`): Zuordnungen und noch nicht gesendete Kontaktvorschläge gehen auf den verbleibenden Kontakt über.
- **Vorschlag entschieden** (`signal.proposal_resolved`): Mailwin vermerkt „übernommen“ oder „verworfen“ an der Meldung. Das ist die Grundlage, um die Schwellen später nachzustellen.

## Signale, Aufgaben, Kontaktdaten (v1.2/v1.3)

Gilt nur für Konversationen, die einem **Lead** zugeordnet sind, und nur, wenn „Signale“ an ist und Nachrichten übertragen werden.

| Mailwin erkennt … | Meldung | Wirkung im CRM (Standard) |
|---|---|---|
| ausgehende Mail mit Angebot (Anhang/Formulierung) | `offer_sent` mit Nummer und Wert | Phase → Angebot, „Angebot nachfassen“; leerer Wert wird übernommen, abweichender vorgeschlagen |
| Vertrag verschickt / unterschrieben zurück | `contract_sent` / `contract_accepted` | Phase → Verhandlung bzw. Vorschlag „Gewonnen?“ |
| Kunde nimmt an / sagt ab | `offer_accepted` / `offer_declined` | Vorschlag „Als gewonnen/verloren markieren?“ |
| Terminwunsch / bestätigter Termin | `meeting_requested` / `meeting_booked` | „Termin vereinbaren“ bzw. Termin im Kalender |
| Rückfrage | `question` | „Rückfrage beantworten“ |
| Abwesenheitsnotiz | `out_of_office` mit Rückkehrdatum | Nachfassen pausiert, **keine** Kundenantwort |
| „Rufen Sie mich Dienstag an“ | Aufgabe (`POST /tasks`, `externalId task:<id>`) | Aufgabe für den Owner |
| Signatur mit Telefon, Position, Adresse | `POST /contacts/{id}/suggestions` | leere Felder füllen, Abweichungen vorschlagen |

So arbeitet die Erkennung:
- **Zweistufig.** Ein günstiger Vorfilter entscheidet, ob eine Nachricht eingeordnet wird: eingehende immer, ausgehende nur bei Angebot, Vertrag oder Terminbestätigung. Dann ordnet Claude die Nachricht mit fester Antwortstruktur ein (`claude-opus-5-5`, Effort `low`, Kosten erscheinen im Admin unter „KI-Kosten“).
- **Abwesenheitsnotizen** erkennt Mailwin ohne Modell (Betreff, Textbausteine) und liest das Rückkehrdatum aus („bis 10.11.“).
- **Gemeldet wird erst ab 60 % Verlässlichkeit.** Zitate müssen wörtlich in der Nachricht stehen (sonst wird nur ohne Zitat gemeldet, also nie automatisch „gewonnen“), höchstens 300 Zeichen. Kontaktdaten nur, wenn sie wörtlich in der Mail stehen.
- **Signale passen zur Richtung.** Ein `offer_sent` gibt es nur für ausgehende Mails, eine Annahme nur für eingehende.
- Signale gibt es nur für Nachrichten der letzten 14 Tage, höchstens 10 je Durchlauf. Beim Update wurden bereits gemeldete Nachrichten als geprüft markiert.
- **Erst speichern, dann senden** (Tabelle `crm_signals`). Fällt das CRM aus, sendet die Wiederholung ohne neue Einordnung. Idempotenz: `signal:<Nachrichten-ID>:<Signal>`, Aufgaben dauerhaft über `externalId`. Ein 422 wird festgehalten und nicht wiederholt.
- **Ohne Marvin** (kein `ANTHROPIC_API_KEY` oder Funktion abgeschaltet) gibt es nur die Abwesenheits-Signale.
- **Die Antwort des CRM wird übernommen:** Phase, Status und nächster Schritt erscheinen sofort auf der Konversation. Das CRM meldet von Mailwin ausgelöste Änderungen nicht per Webhook zurück.
- **Auf der Konversation** zeigt die CRM-Karte den nächsten Schritt und die letzten fünf Meldungen: was erkannt wurde, mit Verlässlichkeit, was das CRM daraus gemacht hat und ob ein Vorschlag übernommen oder verworfen wurde.

**Marvin** liest mit `crm_lookup` auch die Lead-Details (`GET /leads/{id}`): Owner, Wert, nächster Schritt, offene Aufgaben, letzte Aktivitäten. So passen Antwortentwürfe zum Stand im CRM.

**Nachfassen zur richtigen Zeit** (Webhook `lead.next_action_due`):
- Mailwin startet im Hintergrund eine Unterhaltung mit Marvin („CRM: Angebot nachfassen – …“).
- Marvin liest die Konversation, schlägt im CRM nach und legt einen **Entwurf zur Freigabe** an. Gesendet wird nie automatisch.
- Hat der Kunde inzwischen geantwortet, erklärt Marvin, warum kein Entwurf nötig ist.
- Ohne Marvin oder ohne Sendeberechtigung des Postfachs entsteht stattdessen eine **Aufgabe** an der Konversation.

## Was ins CRM geht

| Feld | Inhalt |
|---|---|
| `sourceRef` | `{ channel: "email", threadId: <Mailwin-Konversations-ID>, messageId: <Mailwin-Nachrichten-ID>, url: https://okun-mailwin.com/emails/<threadId> }` |
| Aktivität | Typ `email`, Richtung, Betreff, Vorschau oder Volltext (je Einstellung), Zeitpunkt (UTC), `externalId: email:<id>`, Link `…/emails/<threadId>#m-<id>` |
| `Idempotency-Key` | Lead: `lead:<Nachrichten-ID>:<Prüfsumme des Inhalts>` (Doppelklick legt nichts doppelt an, geänderter Inhalt ist ein neuer Versuch) · Aktivität: `activity:<Nachrichten-ID>` |

Nicht übertragen werden: Anhänge, HTML, Empfängerlisten, E-Mails nicht zugeordneter Konversationen (außer im Modus „alle CRM-Kontakte“).

## Fehlerverhalten

| Antwort des CRM | Verhalten |
|---|---|
| 401/403 (Schlüssel ungültig/widerrufen) | Integration „unterbrochen“, einmalige Benachrichtigung, keine Wiederholung. Neuer Schlüssel in den Einstellungen → wieder aktiv. |
| 429, 409 (Idempotenz in Bearbeitung), 5xx, Netz | Wiederholung mit Backoff (30 s, 1 min, 2 min …) |
| 422 | keine Wiederholung; Meldung mit Feldern an den Nutzer bzw. ins Job-Protokoll |
| 404 bei Aktivität | Zuordnung wird gelöst |

## Sicherheit

- API-Schlüssel und Webhook-Geheimnis werden **AES-256-GCM-verschlüsselt** gespeichert und nie wieder angezeigt. Sie sind auch nicht im Datenexport enthalten.
- Basis-URL nur `https://`. `http://` ist nur für `localhost` erlaubt.
- **Webhook:**
  - HMAC-SHA256 über `<timestamp>.<rohbody>`, Vergleich in konstanter Zeit.
  - Zeitfenster ±5 Minuten.
  - Jedes Ereignis wird je Integration genau einmal verarbeitet (`webhook_events`, 7 Tage aufbewahrt).
  - Falsche Signatur → 401.
- Webhook-Adresse in Mailwin: `…/api/integrations/okun-crm/webhook?i=<Integrations-ID>`. Die Standard-Adresse des CRM ohne `?i=` funktioniert ebenfalls: Dann wählt Mailwin über `X-Okun-Workspace` vor (v1.3). Entscheidend bleibt immer die Signatur.
- Alle Aktionen stehen im Aktivitätsprotokoll: angelegt, zugeordnet, gelöst, Einstellungen, Schlüssel.

## Technik

| Teil | Datei |
|---|---|
| Schnittstelle für alle CRMs | `src/lib/crm/types.ts` (`CrmConnector`) |
| OKUN-CRM-Client | `src/lib/crm/okun.ts` |
| Abläufe A–C, Job | `src/lib/crm/service.ts` |
| Signal-Erkennung (Vorfilter, Claude, Prüfregeln) | `src/lib/crm/signals.ts` |
| Nachfass-Entwurf bei fälligem Schritt | `src/lib/crm/followup.ts`, Job `crm_followup_draft` |
| Webhook (Ablauf D) | `src/lib/crm/webhook.ts`, Route `src/app/api/integrations/okun-crm/webhook/route.ts` |
| Einstellungen | `src/components/CrmIntegrationSection.tsx`, `src/app/(app)/einstellungen/integration-actions.ts` |
| Karte auf der Konversation | `src/components/CrmCard.tsx`, `CrmLeadForm.tsx`, `src/app/(app)/emails/crm-actions.ts` |
| Marvin | Werkzeuge `crm_lookup`, `crm_create_lead` (Freigabe-Aktion `crm_create_lead`), `crm_link_thread`; nur bei aktiver Verbindung |
| Tabellen | `integrations`, `crm_thread_links`, `crm_activities`, `crm_signals`, `webhook_events` (Migrationen `0005_crm_integration`, `0006_crm_signals`) |
| Tests | `tests/crm.test.ts` gegen `tests/crm-mock.ts`: Nachbau der Connect API 1.3 mit Statuscodes, Fehlerhülle, Idempotenz, Validierung und Signal-Regeln (nur vorwärts, Vorschläge) |

HubSpot und Pipedrive kommen als weitere Adapter hinter `CrmConnector` dazu. Oberfläche, Marvin und Jobs bleiben gleich.

## Offen

- **Test gegen die echte Testinstanz** (Anleitung: `docs/CRM-TESTINSTANZ.md`).
- **Akquise-Antworten** (`POST /outreach/replies`) sind noch nicht gebaut. Mailwin müsste dafür erkennen, welche eingehende Mail eine Antwort auf eine Sequenz-Mail des CRM ist, ohne jede Mail ans CRM zu schicken. Der Vorschlag dazu steht in `docs/NACHRICHT-OKUN-CRM-V1.3.md`.
