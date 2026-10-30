# CRM-Anbindung: OKUN CRM (Mailwin-Seite)

Status: **umgesetzt**, getestet gegen einen Nachbau der Connect API v1. Der Test gegen die echte Testinstanz des CRM steht noch aus (siehe unten).

Mailwin nutzt die „Mailwin Connect API“ v1 des OKUN CRM. Die Spezifikation liegt im CRM-Repository unter `docs/mailwin/UEBERGABE-MAILWIN.md` und `openapi.json`. Begriff: Ein Mailwin-„Lead“ ist im CRM ein **Deal**.

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

## Abläufe

| Ablauf | Auslöser in Mailwin | Aufrufe ans CRM |
|---|---|---|
| **A – neue Anfrage** | „Als Lead anlegen“ auf der Konversation oder Marvin (`crm_create_lead`) | `POST /leads` (legt Kontakt/Firma bei Bedarf an) → `GET /contacts` (Kontakt-ID, Phase) → `POST /activities` je Nachricht mit `leadId` |
| **B – Bestandskunde** | „Diesem Lead zuordnen“ / „Nur dem Kontakt zuordnen“, Marvin (`crm_link_thread`) oder automatisch | `GET /contacts` → `POST /activities` mit `leadId` + `contactId` |
| **C – wir schreiben** | Versand aus Mailwin oder neue Nachricht im Ordner „Gesendet“ | `POST /activities` mit `direction: "outbound"` |
| **D – Rückmeldungen** | Webhook des CRM | `lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated`, `ping` |

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
- **Lead im CRM gelöscht** (404 beim Melden): Mailwin löst die Zuordnung, statt endlos zu wiederholen.

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
- Webhook-Adresse in Mailwin: `…/api/integrations/okun-crm/webhook?i=<Integrations-ID>`. Die Standard-Adresse des CRM ohne `?i=` funktioniert ebenfalls; dann prüft Mailwin die Signatur gegen alle hinterlegten Geheimnisse.
- Alle Aktionen stehen im Aktivitätsprotokoll: angelegt, zugeordnet, gelöst, Einstellungen, Schlüssel.

## Technik

| Teil | Datei |
|---|---|
| Schnittstelle für alle CRMs | `src/lib/crm/types.ts` (`CrmConnector`) |
| OKUN-CRM-Client | `src/lib/crm/okun.ts` |
| Abläufe A–C, Job | `src/lib/crm/service.ts` |
| Webhook (Ablauf D) | `src/lib/crm/webhook.ts`, Route `src/app/api/integrations/okun-crm/webhook/route.ts` |
| Einstellungen | `src/components/CrmIntegrationSection.tsx`, `src/app/(app)/einstellungen/integration-actions.ts` |
| Karte auf der Konversation | `src/components/CrmCard.tsx`, `CrmLeadForm.tsx`, `src/app/(app)/emails/crm-actions.ts` |
| Marvin | Werkzeuge `crm_lookup`, `crm_create_lead` (Freigabe-Aktion `crm_create_lead`), `crm_link_thread`; nur bei aktiver Verbindung |
| Tabellen | `integrations`, `crm_thread_links`, `crm_activities`, `webhook_events` (Migration `0005_crm_integration`) |
| Tests | `tests/crm.test.ts` gegen `tests/crm-mock.ts`: Nachbau der Connect API mit Statuscodes, Fehlerhülle, Idempotenz und Validierung |

HubSpot und Pipedrive kommen als weitere Adapter hinter `CrmConnector` dazu. Oberfläche, Marvin und Jobs bleiben gleich.

## Offen

- **Test gegen die echte Testinstanz.** Dafür braucht es:
  - Adresse der Testinstanz und einen Testschlüssel (Arbeitsbereich „Mailwin Sandbox“). Den Schlüssel **nicht in den Chat** kopieren, sondern direkt in Mailwin unter Einstellungen → CRM-Anbindung eintragen.
  - Im CRM als Webhook-Ziel die Adresse aus den Mailwin-Einstellungen eintragen, mit dem Geheimnis.
  - Prüfung: Lead aus Erikas Testanfrage anlegen, Zuordnung zu „Rahmenvertrag 2027“, Antwort am Lead, Phasenwechsel im CRM → Anzeige in Mailwin.
- v1.2 (Signale, `GET /leads/{id}`, Aufgaben …) wird erst gebaut, wenn das CRM die Endpunkte freigibt. Die Rückmeldung zum Entwurf steht in `docs/NACHRICHT-OKUN-CRM-V1.2.md`.
