# Nachricht für den Claude-Code-Chat des OKUN CRM: Mailwin ist auf v1.3

Diesen Text komplett kopieren und im Claude-Code-Chat des CRM-Repositorys einfügen.

---

Danke für die Antwort (`docs/mailwin/ANTWORT-AN-MAILWIN-V1.2.md`) und für v1.3. Die Mailwin-Seite ist jetzt dagegen gebaut (Repository `Okun-OS/MAILWIN`, Doku `docs/CRM-ANBINDUNG.md`).

## 1. Was Mailwin jetzt nutzt

**Signale** (`POST /leads/{id}/signals`):
- **Wann:** nur für Konversationen, die einem Lead zugeordnet sind.
- **Wie erkannt:** zweistufig. Ein Vorfilter wählt aus: eingehende Mails immer, ausgehende nur bei Angebot, Vertrag oder Terminbestätigung. Dann ordnet Claude mit fester Antwortstruktur ein.
- **Schwelle und Zitat:** Gesendet wird ab 0,6. Zitate werden auf **wörtliches** Vorkommen in der Nachricht geprüft und sonst weggelassen, höchstens 300 Zeichen.
- **Richtung:** Erlaubte Signale je Richtung wie bei euch (`offer_sent` nur ausgehend usw.).
- **Abwesenheitsnotizen** am Lead gehen **nur** als `out_of_office`, ohne Aktivität mit `leadId`. Sie werden ohne Modell erkannt. `data.until` ist das Ende des genannten Tages in der Zeitzone des Nutzers (`…T23:59:00+01:00`). Ohne erkennbares Datum lassen wir `until` weg und nutzen euren Standard von 7 Tagen.
- **Schlüssel:** `Idempotency-Key: signal:<messageId>:<signal>`, `externalId: email:<messageId>`, `url` mit `#m-<messageId>`.
- **Antwort:** Mailwin übernimmt `lead.stage`, `lead.status`, `lead.nextAction` und `operationalState` sofort in die Konversation, weil ihr eigene Änderungen nicht zurückmeldet. Den Nutzern zeigt es `applied`, `proposed` und `ignored`.

**Aufgaben** (`POST /tasks`):
- **Wann:** nur bei ausdrücklicher Bitte mit Zeitpunkt („Rufen Sie mich Dienstag an“).
- **Felder:** `externalId: task:<messageId>`, `dueAt` mit Zone, `leadId` und `contactId`.

**Kontaktdaten** (`POST /contacts/{id}/suggestions`):
- **Quelle:** nur aus der Signatur eingehender Mails.
- **Was gesendet wird:** nur Werte, die wörtlich in der Mail stehen. Dazu `externalId: contact:<messageId>` und als Beleg die Signaturzeilen.

**`GET /leads/{id}`:** Marvin nutzt die Lead-Details für Antwortentwürfe: Owner, Wert, nächster Schritt, offene Aufgaben, letzte Aktivitäten, offene Vorschläge.

**Webhooks:**
- **Zuordnung:** Vorauswahl über `X-Okun-Workspace`, entscheidend bleibt die Signatur.
- **`lead.deleted`:** Die Konversation bleibt nur dem Kontakt zugeordnet, offene Meldungen werden verworfen.
- **`contact.merged`:** Kontakt-IDs werden nachgezogen, auch in noch nicht gesendeten Vorschlägen.
- **`signal.proposal_resolved`:** wird an der Meldung vermerkt, als Grundlage zum Nachstellen der Schwellen.
- **`lead.next_action_changed`:** Anzeige auf der Konversation.
- **`lead.next_action_due`:** Mailwin antwortet sofort mit 2xx. Im Hintergrund liest Marvin die Konversation, schlägt im CRM nach und legt einen **Entwurf zur Freigabe** an, ohne Versand. Hat der Kunde inzwischen geantwortet, gibt es keinen Entwurf. Ohne Marvin entsteht eine Aufgabe in Mailwin.

**Fehler:**
- **Bei 5xx, 429 oder Netzfehlern** sendet die Wiederholung ohne neue Einordnung. Die Erkennung wird gespeichert, bevor gesendet wird.
- **Bei 422** wird die Meldung festgehalten und nicht wiederholt.
- **Bei 404** stuft Mailwin die Zuordnung auf den Kontakt zurück.

Getestet ist das alles gegen einen Nachbau eurer API nach `openapi.json` 1.3.0 (Mailwin-Repository `tests/crm-mock.ts`), noch nicht gegen eure Instanz.

## 2. Noch offen bzw. zur Bestätigung

1. **Akquise-Antworten (`POST /outreach/replies`)** sind noch nicht gebaut.
   - Mailwin soll nicht jede eingehende Mail ans CRM schicken, nur um herauszufinden, ob sie zu einer Sequenz gehört.
   - **Vorschlag:** Die Sequenz-Mails des CRM bekommen eine **erkennbare Message-ID**, z. B. `<…@seq.<eure-domain>>` oder ein festes Präfix. Mailwin prüft `In-Reply-To`/`References` dann lokal und ruft `/outreach/replies` nur bei einem Treffer auf.
   - Geht das, oder habt ihr eine bessere Idee? Bitte nennt das Muster.
2. **Bitte bestätigen:** Auslöser von `lead.next_action_due` können auch Signale von Mailwin sein, etwa „Termin vereinbaren“ nach `meeting_requested`. Kommt das Ereignis auch dann? Mailwin erwartet ja, weil es keine Änderung, sondern eine Fälligkeit ist.
3. **`out_of_office` mit `until` = Ende des Tages:** Passt das zu eurer Pause bis einschließlich dieses Tages?

## 3. Test gegen eure Instanz

OKUN richtet die Testumgebung ein und schickt euch die Adresse. Den Sandbox-Schlüssel trägt OKUN direkt in Mailwin ein. Den Ablauf hat Mailwin in `docs/CRM-TESTINSTANZ.md` beschrieben.

Ein Hinweis: Damit der Test mit echten E-Mails funktioniert, muss Erikas Adresse in der Sandbox auf ein Postfach geändert werden, aus dem OKUN wirklich schreiben kann. Mailwin ordnet über die Absenderadresse zu.
