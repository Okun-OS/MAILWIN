# Weitere Kanäle & CRM-Anbindung – Plan

Stand: WhatsApp und weitere Kanäle sind geplant. Die **OKUN-CRM-Anbindung ist umgesetzt**, siehe `docs/CRM-ANBINDUNG.md`. Die Reihenfolge entspricht der Priorität.

---

## 1. WhatsApp und weitere Nachrichtenkanäle

### Grundsatz

Mailwin bindet nur Kanäle mit **offizieller Schnittstelle** an. Inoffizielle Lösungen, etwa WhatsApp Web automatisieren, verstoßen gegen die Nutzungsbedingungen der Anbieter, führen zu Sperren der Nummer und sind datenschutzrechtlich nicht vertretbar.

Technisch wird aus „E-Mail“ ein allgemeiner **Kanal**. Marvin, Freigaben, Projekte und das Protokoll funktionieren dann für jede Nachricht gleich. Der Kanal ist nur die Art der Zustellung.

### WhatsApp (Priorität 1)

**Möglich über die WhatsApp Business Platform (Cloud API) von Meta.**

| Was geht | Was nicht geht |
|---|---|
| Nachrichten an eine **geschäftliche WhatsApp-Nummer** empfangen und beantworten | Private WhatsApp-Chats mitlesen oder beantworten |
| Antworten frei formulieren innerhalb von **24 Stunden** nach der letzten Kundennachricht | Außerhalb der 24 Stunden frei schreiben: Dafür braucht es von Meta **genehmigte Vorlagen** |
| Bilder, PDFs, Sprachnachrichten empfangen | Die bisherige Chat-Historie übernehmen, sofern die Nummer neu angebunden wird |
| Marvin fasst zusammen, schlägt Antworten vor, legt Aufgaben an, Versand nach Freigabe | WhatsApp-Gruppen als normale Unterhaltungen behandeln |

**Was du vorbereiten musst:**
1. Ein **Meta-Business-Konto** (business.facebook.com), möglichst **verifiziert**: Handelsregister, Adresse, Website `okun-mailwin.com`.
2. Eine **Meta-App** (developers.facebook.com) mit dem Produkt **WhatsApp**.
3. Strategisch: Mailwin als **Tech Provider** bei Meta registrieren. Dann verbindet jeder Kunde **seine eigene** WhatsApp-Business-Nummer per „Embedded Signup“, mit wenigen Klicks direkt in Mailwin. Ohne Tech-Provider-Status ginge nur eure eigene Nummer.
4. Für die eigene Nummer: Die Nummer darf nicht gleichzeitig in der normalen WhatsApp-App laufen. Ob „Koexistenz“ mit der WhatsApp-**Business**-App möglich ist, hängt vom Land und dem aktuellen Stand bei Meta ab; das prüfen wir bei der Einrichtung.
5. Kosten: Meta berechnet je nach Nachrichtentyp und Land, vor allem Vorlagen-Nachrichten. Antworten im 24-Stunden-Fenster sind derzeit weitgehend kostenlos. Die aktuellen Preise stehen bei Meta.

**Was ich in Mailwin baue:**
- Webhook-Empfang (`/api/channels/whatsapp/webhook`, signaturgeprüft)
- Chat-Ansicht neben dem Posteingang
- Marvin-Werkzeuge für WhatsApp
- Vorlagenverwaltung
- 24-Stunden-Fenster-Logik
- Freigabe vor jedem Versand

### Weitere Kanäle – Bewertung

| Kanal | Offizielle Schnittstelle | Nutzen für Mailwin | Empfehlung |
|---|---|---|---|
| **Microsoft Teams** | ja (Microsoft Graph, Chats und Kanäle) | Interne Abstimmung zu Projekten; nutzt die vorhandene Microsoft-Anbindung | Priorität 2 |
| **Slack** | ja (Slack-App mit OAuth) | Interne Benachrichtigungen, z. B. „Antwort der Prüfstelle eingegangen“; Marvin im Team-Kanal | Priorität 2 |
| **SMS** | ja (Twilio, Zugang vorhanden) | Erinnerungen und kurze Rückfragen an Kunden ohne E-Mail | Priorität 3, wenig Aufwand |
| **Facebook Messenger / Instagram Direct** | ja (Meta Messaging API, für Unternehmensseiten) | Anfragen aus Social Media im selben Posteingang; gleiche Meta-Vorbereitung wie WhatsApp | Priorität 3 |
| **Telegram** | ja, aber nur über Bots | Kunden schreiben einem Mailwin-Bot; kein Zugriff auf private Chats | optional |
| **Threema Work / Gateway** | ja (kostenpflichtiges Gateway) | Für datenschutzsensible Branchen | auf Nachfrage |
| LinkedIn-Nachrichten | **nein** (nur für ausgewählte Partner) | – | nicht möglich |
| iMessage, Signal, privates WhatsApp | **nein** | – | nicht möglich |

---

## 2. CRM-Anbindung

### Ziel

Mailwin erkennt aus E-Mails und Chats, was ins CRM gehört, und überträgt es direkt. Beispiele:
- „Neue Kundenanfrage von Weber Digital“ → **Lead** im CRM anlegen, mit Kontakt, Firma, Zusammenfassung und Link zur Konversation.
- Antwort eines Interessenten → als **Aktivität** am Kontakt bzw. Deal protokolliert.
- Marvin fragt vor dem Antworten im CRM nach: Wer ist das? Welche Deals laufen? Was wurde zuletzt besprochen?

### Strategie: eigenes CRM zuerst, dann HubSpot und Pipedrive, Rest über eine Sammel-Schnittstelle

1. **OKUN CRM (zuerst).** Ihr kontrolliert beide Seiten und könnt das Zusammenspiel perfekt abstimmen. Das ist ein Verkaufsargument für beide Produkte. Wir definieren dafür eine **offene, dokumentierte Schnittstelle** („Mailwin Connect API“, siehe unten). Das OKUN CRM setzt sie um, Mailwin nutzt sie.
2. **HubSpot und Pipedrive (danach, nativ).** Das sind die verbreitetsten CRMs im deutschsprachigen Mittelstand. Beide haben gute APIs mit OAuth und App-Marktplätzen, über die Kunden Mailwin finden.
3. **Salesforce, Zoho, Microsoft Dynamics u. a. (bei Bedarf).** Entweder nativ, wenn ein großer Kunde es braucht, oder über einen **Unified-API-Anbieter** (z. B. Merge, Apideck, Nango), der viele CRMs über eine Schnittstelle bündelt. Abwägung: weniger Entwicklungsaufwand, aber laufende Kosten und ein zusätzlicher Auftragsverarbeiter (DSGVO).

**In Mailwin** entsteht dafür eine eigene Schicht, aufgebaut wie die E-Mail-Anbieter: ein gemeinsames `CrmConnector`-Interface mit je einem Adapter pro CRM. Marvin, Automationen und die Oberfläche sprechen nur mit dem Interface.

```
CrmConnector
  findContactByEmail(email)            → Kontakt + Firma + offene Leads/Deals
  upsertContact({ email, name, phone, company })
  createLead({ contact, title, description, source, sourceRef })
  logActivity({ recordRef, type: "email" | "whatsapp", direction, subject, summary, occurredAt, externalId })
  listPipelines()                      → Pipelines und Phasen
```

**Funktionen in Mailwin:**
- **Einstellungen → Integrationen:** CRM verbinden. Beim OKUN CRM zuerst per API-Schlüssel, später per OAuth; bei HubSpot und Pipedrive per OAuth.
- **Neben jeder Konversation eine CRM-Karte:** Kontakt, Firma, offene Deals; Knopf „Als Lead anlegen“.
- **Marvin-Werkzeuge:** `crm_lookup`, `crm_create_lead`, `crm_log_activity`. Schreibende Aktionen laufen über das bestehende Freigabemodell und sind pro Kunde einstellbar: „immer fragen“ oder „automatisch“.
- **Automationsregel** (Phase 2): „Neue Kundenanfragen automatisch als Lead ins CRM“.
- **Datensparsamkeit:** Standardmäßig gehen nur Zusammenfassung und Link ins CRM, nicht der vollständige E-Mail-Text. Das lässt sich pro Kunde ändern.

---

## 3. Schnittstelle „Mailwin Connect API“ – Vertrag für das OKUN CRM

Version 1. Diese Spezifikation setzt das OKUN CRM um. Mailwin ist der Aufrufer.

**Grundlagen**
- Basis-URL pro CRM-Instanz, z. B. `https://crm.okun-systems.com/api/mailwin/v1`
- **Authentifizierung v1:** `Authorization: Bearer <API-Schlüssel>`. Der Schlüssel wird im CRM pro Arbeitsbereich erzeugt, ist widerrufbar und hat nur die hier genannten Rechte. **v2:** OAuth 2.0 (Authorization Code + PKCE), damit Kunden per Klick verbinden.
- JSON, UTF-8, Zeitstempel in ISO 8601 mit Zeitzone.
- **Idempotenz:** Schreibende Aufrufe senden den Header `Idempotency-Key`. Derselbe Schlüssel innerhalb von 24 Stunden liefert dasselbe Ergebnis und legt nichts doppelt an.
- **Fehler:** `{ "error": { "code": "not_found", "message": "…" } }` mit passendem HTTP-Status. Bei 429 kommt ein `Retry-After`-Header mit.

**Endpunkte**

| Methode & Pfad | Zweck |
|---|---|
| `GET /me` | Prüft den Schlüssel und liefert Arbeitsbereich: `{ workspaceId, name, appUrl }` |
| `GET /contacts?email=…` | Kontakt(e) zu einer E-Mail-Adresse, inkl. Firma und offener Leads/Deals: `{ id, name, email, phone, company:{ id, name, domain }, openLeads:[{ id, title, stage, url }], url }` |
| `POST /contacts` | Kontakt anlegen oder aktualisieren (Abgleich über E-Mail): `{ email, name?, phone?, companyName?, companyDomain? }` → Kontakt |
| `GET /pipelines` | `[{ id, name, stages:[{ id, name, order }] }]` |
| `POST /leads` | Lead/Anfrage anlegen: `{ contact:{ email, name? }, companyName?, title, description, pipelineId?, stageId?, valueCents?, source:"mailwin", sourceRef:{ channel:"email"\|"whatsapp", threadId, messageId, url } }` → `{ id, url }` |
| `POST /activities` | Aktivität protokollieren: `{ contactId?, leadId?, type:"email"\|"whatsapp"\|"note", direction:"inbound"\|"outbound", subject?, summary, occurredAt, externalId, url }` → `{ id }`. Über `externalId` idempotent. |

**Webhooks (CRM → Mailwin)**, optional ab v1.1:
- `POST https://okun-mailwin.com/api/integrations/okun-crm/webhook`
- Header `X-Okun-Signature: sha256=<HMAC des Rohinhalts mit dem gemeinsamen Geheimnis>` und `X-Okun-Timestamp`. Mailwin verwirft Anfragen, die älter als 5 Minuten sind.
- Ereignisse: `lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated`. Damit kann Marvin z. B. erkennen, dass ein Deal gewonnen wurde, und Follow-ups stoppen.

**Sicherheit**
- Schlüssel im CRM nur als Hash speichern.
- Rate-Limit: 120 Anfragen pro Minute und Schlüssel.
- Jeder Aufruf wird im CRM protokolliert, mit Herkunft „Mailwin“.
- Kontaktdaten nur für den Arbeitsbereich des Schlüssels; keine bereichsübergreifenden Abfragen.

---

## 4. Reihenfolge nach Phase 1

1. Stripe-Buchung und Website vor der Anmeldung (wird von dir vorbereitet)
2. Phase 2 aus dem Master-Prompt: Postfach-Aufräumassistent und Automationsregeln
3. ~~CRM: Mailwin-Seite der OKUN-CRM-Anbindung~~ ✅ umgesetzt; Test gegen die echte Testinstanz offen
4. **WhatsApp Business**, sobald Meta-Konto und App vorbereitet sind
5. HubSpot- und Pipedrive-Adapter
6. Teams/Slack, Messenger/Instagram, SMS an Kunden
