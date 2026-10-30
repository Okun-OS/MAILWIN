# Nachricht für den Claude-Code-Chat des OKUN CRM

Diesen Text komplett kopieren und im Claude-Code-Chat des CRM-Repositorys einfügen.

---

Wir verbinden unser CRM mit **OKUN Mailwin**, unserem KI-E-Mail-Assistenten (Repository `Okun-OS/MAILWIN`, live unter https://okun-mailwin.com). Mailwin soll aus E-Mails und später WhatsApp-Nachrichten automatisch Leads anlegen, Kontakte nachschlagen und Aktivitäten protokollieren. Dafür braucht das CRM eine neue, eigenständige Schnittstelle: die **„Mailwin Connect API“ v1**. Mailwin ist der Aufrufer, das CRM der Anbieter.

**Bitte zuerst:** Analysiere die bestehende Architektur des CRM: Datenmodell für Kontakte, Firmen, Leads/Deals, Pipelines und Aktivitäten, dazu Authentifizierung, Mandantentrennung und API-Konventionen. Schlag mir vor, wie sich die Schnittstelle sauber einfügt, und setze sie dann um. Wo unser Datenmodell anders heißt (z. B. „Deal“ statt „Lead“), bilde es auf die Schnittstelle ab und dokumentiere die Zuordnung. Das Ziel ist, das bestehende Modell zu nutzen, nicht es umzubauen.

### Anforderungen

**Grundlagen**
- Basis-Pfad `/api/mailwin/v1`, JSON, UTF-8, Zeitstempel ISO 8601 mit Zeitzone.
- **API-Schlüssel pro Arbeitsbereich/Mandant:**
  - Im CRM unter „Einstellungen → Integrationen → Mailwin“ erzeugen, anzeigen (nur einmal), benennen und widerrufen.
  - Gespeichert wird nur ein Hash.
  - Aufruf mit `Authorization: Bearer <schlüssel>`.
  - Der Schlüssel hat ausschließlich die Rechte dieser Schnittstelle und sieht nur Daten seines Arbeitsbereichs.
- **Idempotenz:** Schreibende Aufrufe akzeptieren den Header `Idempotency-Key`. Derselbe Schlüssel innerhalb von 24 Stunden liefert dieselbe Antwort und legt nichts doppelt an.
- **Fehlerformat:** `{ "error": { "code": "…", "message": "…" } }` mit korrektem HTTP-Status (400, 401, 403, 404, 409, 422, 429). Bei 429 ein `Retry-After`-Header.
- **Rate-Limit:** 120 Anfragen pro Minute und Schlüssel.
- Jeder Aufruf wird im CRM-Protokoll mit Herkunft „Mailwin“ vermerkt. Angelegte Datensätze tragen die Quelle `mailwin`.

**Endpunkte**
1. `GET /me` → `{ workspaceId, name, appUrl }`. Dient zum Prüfen des Schlüssels.
2. `GET /contacts?email=<adresse>` → Liste passender Kontakte, Groß-/Kleinschreibung egal:
   `{ id, name, email, phone, company: { id, name, domain } | null, openLeads: [{ id, title, stage, url }], url }`
   `url` ist der Direktlink zum Datensatz in der CRM-Oberfläche.
3. `POST /contacts` mit `{ email, name?, phone?, companyName?, companyDomain? }` → legt an oder aktualisiert (Abgleich über E-Mail); Firma über Domain bzw. Namen zuordnen oder anlegen. Antwort wie bei 2.
4. `GET /pipelines` → `[{ id, name, stages: [{ id, name, order }] }]`
5. `POST /leads` mit
   `{ contact: { email, name? }, companyName?, title, description, pipelineId?, stageId?, valueCents?, source: "mailwin", sourceRef: { channel: "email" | "whatsapp", threadId, messageId, url } }`
   → `{ id, url }`. Ohne Pipeline/Phase gilt die Standard-Pipeline mit der ersten Phase. Fehlende Kontakte werden angelegt. `sourceRef.url` als Link „In Mailwin öffnen“ am Lead anzeigen.
6. `POST /activities` mit
   `{ contactId?, leadId?, type: "email" | "whatsapp" | "note", direction: "inbound" | "outbound", subject?, summary, occurredAt, externalId, url }`
   → `{ id }`. Über `externalId` idempotent. Mindestens `contactId` oder `leadId` ist Pflicht. In der Zeitleiste von Kontakt bzw. Lead anzeigen.

**Webhooks an Mailwin** (v1.1, gern gleich mit vorbereiten)
- Im Integrationsbereich eine Webhook-URL (Standard: `https://okun-mailwin.com/api/integrations/okun-crm/webhook`) und ein gemeinsames Geheimnis hinterlegen.
- Ereignisse `lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated` als POST mit Body `{ id, type, occurredAt, data }`.
- Header:
  - `X-Okun-Timestamp`: Unix-Sekunden
  - `X-Okun-Signature`: `sha256=` + HMAC-SHA256 über `<timestamp>.<rohbody>` mit dem Geheimnis
- Zustellung asynchron mit Wiederholung (exponentielles Backoff, max. 24 Stunden) und Zustellprotokoll.

### Lieferumfang
- Die Endpunkte mit Validierung, Mandantentrennung, Idempotenz und Rate-Limit.
- Die Oberfläche für Schlüssel (und Webhook-Einstellungen).
- Eine **OpenAPI-3.1-Spezifikation** unter `/api/mailwin/v1/openapi.json` sowie als Datei im Repository.
- **Automatisierte Tests**, mindestens:
  - falscher/widerrufener Schlüssel → 401
  - fremder Mandant → keine Daten
  - Idempotenz bei `POST /leads` und `POST /activities`
  - Kontakt-Upsert über E-Mail
  - Lead ohne bestehenden Kontakt legt Kontakt an
  - 429 bei Überschreitung
- Eine kurze Anleitung „Mailwin verbinden“ für Kunden.
- Am Ende: **eine Zusammenfassung für den Mailwin-Chat** mit Basis-URL, Abweichungen von dieser Spezifikation, Beispiel-Requests/-Responses und Hinweisen zur Testumgebung, plus einem Testschlüssel für eine Testinstanz (nicht für Produktivdaten). Die Zusammenfassung gebe ich dem Mailwin-Chat, der die Gegenseite baut.

### Später (bitte in der Architektur berücksichtigen, noch nicht bauen)
- OAuth 2.0 (Authorization Code + PKCE) als Alternative zum API-Schlüssel, damit Kunden per Klick verbinden.
- Weitere Kanäle (WhatsApp) nutzen dieselben Endpunkte mit `channel: "whatsapp"`.
