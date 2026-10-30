# Umsetzungsstand

Legende: ✅ umgesetzt und getestet · 🟡 umgesetzt, aber nicht gegen den echten Dienst getestet · ⬜ offen

## Wie getestet wird

- **`npm test`** (68 Tests):
  - Unit-Tests: MIME, Gmail-Parser, Verschlüsselung, Passwörter, Einmal-Codes, Zeitzonen.
  - Integrationstests gegen echtes PostgreSQL: Sync, Freigaben, Berechtigungen, Mandantentrennung, Agenten-Loop, Warteschlange, Admin-Start.
  - **IMAP/SMTP gegen einen echten IMAP-Server** (Dovecot) und einen SMTP-Testserver. Der Test läuft nur, wenn `IMAP_TEST_PORT` (Standard 14300) erreichbar ist.
  - Microsoft Graph gegen eine nachgebildete API.
  - **OKUN CRM** gegen einen Nachbau der Connect API v1 (`tests/crm-mock.ts`, nach `openapi.json` des CRM): Abläufe A–D, Idempotenz, 401/404/422/429, Webhook-Signatur und Duplikate.
- **Browser:** Login, Pflicht-Passwortwechsel, Admin-Bereich, Kunde anlegen, Kundenlogin, IMAP-Verbindung mit falschem Passwort, CRM verbinden (falscher und richtiger Schlüssel), Lead aus einer Konversation anlegen, signierter und gefälschter Webhook.
- **Live:** Gmail-Anmeldung und Synchronisation auf okun-mailwin.com.
- **Nicht gegen echte Dienste getestet:**
  - Resend (E-Mail-Codes) und Twilio (SMS): Es lagen keine Schlüssel vor.
  - Microsoft Graph: Es gibt noch keine App-Registrierung.
  - Claude-API: Der Loop ist nur mit nachgebildetem Modell getestet.
  - OKUN CRM: Testinstanz-Adresse und Sandbox-Schlüssel stehen noch aus.

## Phase 1 – Fundament

| Funktion | Stand |
|---|---|
| Gmail: Anmeldung, Sync, Lesen, Senden, Antworten, Weiterleiten, Labels, Archiv, Papierkorb, Anhänge | ✅ live verbunden |
| Kalender (Google, Microsoft) im Dashboard | ✅ Google · 🟡 Microsoft |
| Dashboard nach Referenzdesign | ✅ |
| Marvin mit echten Werkzeugen, Freigabemodell, Audit-Log | 🟡 echte Claude-API ungetestet |
| Signatur pro Konto | ✅ |
| Projekte im Gespräch mit Marvin | 🟡 Grundlage |

## Anmeldung, Sicherheit & Admin

| Funktion | Stand |
|---|---|
| Login mit E-Mail/Passwort, Sperre nach 5 Fehlversuchen | ✅ |
| Admin-Zugang über `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD`, Pflicht-Passwortwechsel | ✅ |
| Keine Selbstregistrierung per Google (abschaltbar über `ALLOW_GOOGLE_SIGNUP`) | ✅ |
| 2FA per E-Mail (Resend) oder SMS (Twilio) | 🟡 Code-Logik getestet, Versand nicht |
| Passwort vergessen / zurücksetzen / ändern, überall abmelden | ✅ (Versand des Links 🟡) |
| Admin: Kunden anlegen, Passwort setzen, Reset-Link, sperren, abmelden, 2FA zurücksetzen, Rolle, Abo-Status, Notizen, Postfächer, Export, Löschen | ✅ |
| Admin: Gutscheine, Aktionen, Systemmeldungen, Protokoll, System, KI-Kosten je Kunde, Feature-Schalter | ✅ |
| DSGVO-Datenexport (Admin & Kunde), vollständiges Löschen inkl. Widerruf der Google-Zugriffe | ✅ |

## Weitere Postfächer

| Funktion | Stand |
|---|---|
| IMAP/SMTP: GMX, WEB.DE, T-Online, iCloud, Yahoo, IONOS, STRATO, eigene Domain | ✅ gegen echten IMAP-Server getestet |
| Microsoft 365 / Outlook.com über Microsoft Graph | 🟡 App-Registrierung nötig (`docs/MICROSOFT.md`) |

## CRM-Anbindung (OKUN CRM)

| Funktion | Stand |
|---|---|
| Verbinden per API-Schlüssel, Prüfung über `GET /me`, Status „unterbrochen“ bei widerrufenem Schlüssel | ✅ gegen Nachbau · 🟡 echte Instanz |
| Karte auf jeder Konversation: Kontakt, Firma, offene Leads, zuordnen, „Als Lead anlegen“ | ✅ |
| Nachrichten am Lead protokollieren (ein- und ausgehend, genau einmal), Abwesenheitsnotizen nur am Kontakt | ✅ |
| Automatische Zuordnung bei genau einem offenen Lead (optional) | ✅ |
| Marvin: `crm_lookup`, `crm_create_lead` (mit Freigabe oder direkt), `crm_link_thread` | ✅ (echte Claude-API ungetestet) |
| Webhooks: Phase, gewonnen/verloren, Kontaktänderung, Ping, signaturgeprüft | ✅ |
| Admin: CRM-Status je Kunde, Feature-Schalter, Export ohne Schlüssel | ✅ |
| v1.2 (Signale, Aufgaben, Lead-Details) | ⬜ wartet auf das CRM, Rückmeldung in `docs/NACHRICHT-OKUN-CRM-V1.2.md` |

Doku: `docs/CRM-ANBINDUNG.md`.

## Bekannte Einschränkungen

- IMAP und Microsoft: Synchronisiert werden **Posteingang und Gesendet**. Archivierte Nachrichten verschwinden daher aus Mailwin, bleiben aber im Postfach beim Anbieter.
- Gutscheine sind angelegt, werden aber erst mit der Stripe-Anbindung eingelöst.
- Abo-Status pflegt der Admin bis zur Stripe-Anbindung von Hand.
- KI-Kosten sind Schätzwerte nach Listenpreis.
- CRM: Abwesenheitsnotizen werden am Betreff und an eindeutigen Textbausteinen erkannt (Kopfzeilen wie `Auto-Submitted` werden nicht gespeichert). Beim Verbinden werden ältere Konversationen nicht nachträglich übertragen, nur neue Nachrichten und manuell zugeordnete Konversationen.

## Offen (in dieser Reihenfolge)

1. Website vor der Anmeldung und Buchung über Stripe (Vorbereitung durch OKUN)
2. Phase 2: Postfach-Aufräumassistent, Automationsregeln, KI-Priorisierung
3. CRM: Test gegen die OKUN-CRM-Testinstanz, danach v1.2 (Signale) sowie HubSpot/Pipedrive-Adapter: siehe `docs/CRM-ANBINDUNG.md`
4. WhatsApp Business und weitere Kanäle: siehe `docs/KANAELE-UND-CRM.md`
5. Phase 3/4: Recherchequellen speichern, Antwortüberwachung, Follow-ups
6. Gmail-Push statt Polling, Streaming von Marvins Antworten

## Betrieb

- Die Gmail-Berechtigungen gelten bei Google als *restricted*. Für externe Nutzer verlangt Google eine App-Verifizierung mit Sicherheitsprüfung. Im Testmodus sind höchstens 100 eingetragene Testnutzer möglich, deren Freigabe nach 7 Tagen abläuft.
- Marvin übermittelt E-Mail-Inhalte an die Claude-API (Anthropic). Das gehört in die Datenschutzerklärung und den Auftragsverarbeitungsvertrag.
- Railway-Region auf EU umstellen, bevor echte Kundendaten verarbeitet werden.
