# Umsetzungsstand

Stand: Phase 1 (Fundament), erster Durchgang. Legende: ✅ umgesetzt und getestet · 🟡 umgesetzt, aber nicht gegen echte Dienste getestet oder nur teilweise · ⬜ offen

## Wie getestet wurde

- **Automatisierte Tests** (`npm test`, 30 Tests): MIME-Erzeugung und -Dekodierung, Gmail-Parser, Verschlüsselung, Zeitzonen, Begrüßung, Verlaufsaufbau. Dazu Integrationstests gegen echtes PostgreSQL mit einem Fake-Mailanbieter und einem Fake-Modell für Sync, Freigaben, Berechtigungen, Mandantentrennung, Agenten-Loop, Prompt-Injection-Markierung und Warteschlange.
- **Visuell**: Dashboard, Posteingang, Thread, Marvin, Projektstart und Einstellungen wurden mit lokalen Testdaten bei 1672, 1440, 900 und 390 px geprüft.
- **Nicht getestet**:
  - Echte Google-OAuth-Anmeldung und Gmail- bzw. Kalender-API: In der Entwicklungsumgebung gab es keine Google-Zugangsdaten. Der Adapter folgt der offiziellen API, Parser und MIME-Builder sind mit Unit-Tests abgedeckt.
  - Echte Aufrufe der Claude-API: Es war kein API-Schlüssel gesetzt. Der Loop ist mit einem Fake-Modell getestet.

## Phase 1

| Funktion | Stand | Hinweis |
|---|---|---|
| Anmeldung mit Google (OAuth 2 + PKCE), Sitzungen | 🟡 | Gegen echtes Google noch nicht durchgespielt |
| Mehrere Gmail-Konten verbinden, gemeinsamer und einzelner Posteingang | 🟡 | |
| Token verschlüsselt (AES-256-GCM), Neu-Verbinden bei abgelaufenem Zugriff | ✅ | Abnahmetest 9 als Integrationstest |
| Synchronisation (Erstabgleich 30 Tage + History-Delta) im Worker | 🟡 | Logik getestet, Gmail-Aufrufe nicht |
| Posteingang mit Filtern, Suche, Thread-Ansicht, sichere HTML-Anzeige | ✅ | Externe Bilder standardmäßig blockiert |
| Senden, Antworten (Threading), Weiterleiten inkl. Anhängen | 🟡 | MIME getestet, Versand über Gmail nicht |
| Archivieren, Papierkorb, gelesen/ungelesen, Labels | 🟡 | |
| Anhänge herunterladen | 🟡 | |
| Kalender (Google, nur lesen) | 🟡 | |
| Dashboard nach Referenzdesign mit echten Daten und Leerzuständen | ✅ | |
| Marvin-Chat mit echten Tools (Suche, Thread lesen, Entwurf, Labels, Archiv, Aufgaben, Kalender, Websuche) | 🟡 | Loop getestet, echte API nicht |
| Freigabemodell (Stufen 1–3 pro Konto, kritische Aktionen gesondert) | ✅ | Abnahmetest 8 |
| Audit-Protokoll inkl. verweigerter Aktionen | ✅ | |
| Signatur pro Konto, automatisch angehängt | ✅ | Abnahmetest 7 in einfacher Form (Text), kein Studio |
| In-App-Benachrichtigungen | ✅ | Für Freigaben und Sync-Fehler |
| Projektstart im Gespräch mit Marvin, Projektplan als Aufgaben | 🟡 | Grundlage für Phase 3: keine Abhängigkeiten, keine Quellenverwaltung |

## Bewusst noch nicht umgesetzt

| Bereich | Phase | Bemerkung |
|---|---|---|
| Postfach-Aufräumassistent (Analyse, Kategorien in Serie, Löschvorschau) | 2 | „Postfach ordnen“ öffnet Marvin. Er kann bisher nur einzeln labeln und archivieren. |
| Automationsregeln und Regel-Engine | 2 | Tabellen vorhanden, keine Oberfläche, kein Worker-Handler. Die Kachel „Automatisch sortiert“ zeigt deshalb ehrlich 0. |
| KI-Priorisierung und Kategorisierung | 2 | „Antwort erforderlich“ wird heute regelbasiert ermittelt (letzte Nachricht von außen, im Posteingang, kein No-Reply-Absender). |
| Recherchequellen dauerhaft speichern, verifizierte Kontakte aus Recherche | 3 | Websuche funktioniert, die Quellen erscheinen nur im Chat. |
| Antwortüberwachung, Follow-up-Automationen | 4 | „Wartet auf Antwort“ wird bereits erkannt und angezeigt. |
| Microsoft 365, IMAP/SMTP | 5 | Das Interface ist vorbereitet. |
| Signatur-Studio (HTML-Layouts, Logo) | 5 | |
| Gmail-Push (Pub/Sub) statt Polling | – | Polling alle 2 Minuten |
| Streaming von Marvins Antworten | – | Die Antwort erscheint als Ganzes, mit Arbeitsanzeige. |

## Wichtige Hinweise für den Betrieb

- Die Gmail-Scopes `gmail.modify` und `gmail.send` gelten bei Google als *restricted*. Für externe Nutzer verlangt Google eine App-Verifizierung inklusive Sicherheitsprüfung. Im Testmodus funktionieren bis zu 100 eingetragene Testnutzer.
- Marvin übermittelt E-Mail-Inhalte an die Claude-API (Anthropic), sobald der Nutzer ihn fragt. Das gehört in die Datenschutzerklärung und den Auftragsverarbeitungsvertrag.
