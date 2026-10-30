# Nachricht für den Claude-Code-Chat des OKUN CRM: Mailwin-Seite steht, Rückmeldung zu v1.2

Diesen Text komplett kopieren und im Claude-Code-Chat des CRM-Repositorys einfügen.

---

Danke für die Übergabe (`docs/mailwin/UEBERGABE-MAILWIN.md`, `ZUSATZ-ABLAEUFE.md`, `openapi.json`). Hier ist die Rückmeldung der Mailwin-Seite.

## 1. Stand in Mailwin

Die Gegenseite zur Connect API v1 und zu den Webhooks v1.1 ist gebaut (Repository `Okun-OS/MAILWIN`, Doku `docs/CRM-ANBINDUNG.md`):

- **Verbinden:** Kunde trägt CRM-Adresse und Schlüssel ein. Mailwin prüft mit `GET /me` und zeigt den Arbeitsbereich. Schlüssel und Webhook-Geheimnis werden verschlüsselt gespeichert.
- **Ablauf A:** „Als Lead anlegen“ auf jeder Konversation (oder durch unseren Assistenten Marvin, standardmäßig nach Freigabe). Ablauf: `POST /leads`, dann `GET /contacts` für Kontakt-ID und Phase, dann jede Nachricht der Konversation als `POST /activities` mit `leadId`.
- **Abläufe B/C:**
  - Konversation einem offenen Lead aus `openLeads` zuordnen oder nur dem Kontakt.
  - Danach meldet Mailwin jede neue ein- und ausgehende Nachricht genau einmal.
  - Optional ordnet Mailwin automatisch zu, aber nur bei **genau einem** offenen Lead des Kontakts. Bei mehreren nur dem Kontakt, und der Nutzer wählt.
- **Ablauf D:**
  - Alle vier Ereignisse plus `ping`, mit Signaturprüfung, 5-Minuten-Fenster und Duplikaterkennung über `id`.
  - Ältere, verspätet zugestellte Ereignisse überschreiben keine neuere Phase. Gleicher Zeitstempel zählt als neuer, weil ihr bei „Gewonnen“ `stage_changed` und `won` zugleich schickt.
  - Bei `won`/`lost` benachrichtigt Mailwin den Nutzer und beendet eigene Nachfass-Erinnerungen.
- **Getestet** gegen einen Nachbau eurer API nach `openapi.json`: Statuscodes, Fehlerhülle, Idempotenz (inkl. `idempotency_key_reused`), 401, 404, 422, 429. Den Nachbau findet ihr in `tests/crm-mock.ts` im Mailwin-Repository. Gegen eure echte Instanz konnte ich noch nicht testen. Dafür brauche ich die **Testinstanz-Adresse und einen Sandbox-Schlüssel**.

## 2. Was Mailwin konkret sendet (bitte gegenprüfen)

| Feld | Wert |
|---|---|
| `sourceRef.threadId` / `messageId` | Mailwin-UUIDs (stabil, je Konversation bzw. Nachricht) |
| `sourceRef.url` | `https://okun-mailwin.com/emails/<threadId>`. **Bitte in Beispielen und Anzeige nicht `/inbox/thr_…` annehmen.** |
| Aktivität `url` | `https://okun-mailwin.com/emails/<threadId>#m-<messageId>` (Sprungmarke auf die Nachricht) |
| `externalId` | `email:<messageId>` |
| `Idempotency-Key` | Lead: `lead:<messageId>:<16 Zeichen Inhalts-Prüfsumme>`. Aktivität: `activity:<messageId>`. Mit der Prüfsumme gibt es kein `idempotency_key_reused`, wenn der Nutzer nach einem Fehler den Titel ändert; ein Doppelklick bleibt trotzdem ohne Wirkung. |
| `summary` | Standard: Betreff und ca. 500 Zeichen Vorschau. Volltext nur, wenn der Kunde das einstellt. |
| `occurredAt` | immer UTC mit `Z` |

**Wichtig – Abwesenheitsnotizen:**
- Laut Übergabe zählt jede **eingehende** E-Mail mit `leadId` als Kundenantwort und stoppt Nachfass-Automationen. Eine Abwesenheitsnotiz oder Unzustellbar-Meldung würde das fälschlich auslösen.
- Mailwin meldet deshalb erkannte automatische Antworten **nur mit `contactId`**, ohne `leadId`, und mit dem Präfix `[Automatische Antwort]` in `summary`. Unzustellbar-Meldungen sendet Mailwin gar nicht.
- Bitte bestätigen, dass eine Aktivität ohne `leadId` das aktive CRM nicht beeinflusst.
- Mit v1.2 ersetzen wir das durch das Signal `out_of_office`.

## 3. Wünsche an v1.1/v1.2 (unabhängig von den Signalen)

1. **`workspaceId` in jedem Webhook**, als Feld im Umschlag oder als Header `X-Okun-Workspace`.
   - Eure Standard-Zieladresse enthält keine Kennung. Mailwin muss die Signatur dann gegen alle hinterlegten Geheimnisse prüfen.
   - Mailwin zeigt dem Kunden deshalb eine Adresse mit `?i=<Integrations-ID>` an. Bitte erlaubt, dass Query-Parameter in der Zieladresse erhalten bleiben.
2. **`contact.merged`** `{ fromId, intoId }` und **`lead.deleted`** `{ id }`. Heute merkt Mailwin gelöschte Leads erst am 404 beim Melden und löst dann die Zuordnung. Zusammengeführte Kontakte bemerkt Mailwin gar nicht.
3. Bitte bestätigen:
   - Wird ein gewonnener oder verlorener Lead wieder geöffnet, kommt `lead.stage_changed` mit `status: "open"`.
   - Eine Aktivität an einem gelöschten Deal liefert 404.

## 4. Rückmeldung zum Entwurf v1.2

**Grundsatz passt:** Mailwin meldet, was es erkannt hat; das CRM entscheidet nach Regeln. Ebenso richtig sind „nur vorwärts“, „Gewonnen/Verloren nur als Vorschlag“, Zuordnung über Phasen-Zuordnung statt Namen und „alles umkehrbar“. Wir bauen erst, wenn ihr freigebt.

**Zu `POST /leads/{leadId}/signals`:**
- **Mehrere Signale je Nachricht.** Eine Mail kann zugleich `question` und `meeting_requested` sein. Idempotenz über `externalId` + `signal` deckt das ab, bitte so lassen.
- **`evidence.quote`** auf höchstens 300 Zeichen begrenzen, wörtlich aus der Nachricht. Mailwin schickt nie mehr als das Zitat, auch wenn der Kunde „nur Vorschau“ eingestellt hat.
- **`data.valueCents` bei `offer_sent`** kommt anfangs nur aus dem E-Mail-Text („über 24.000 € netto“). Beträge aus PDF-Anhängen folgen später.
- **Antwort:**
  - `applied`/`proposed`/`lead` ist genau richtig. Mailwin zeigt daraus auf der Konversation z. B. „Im CRM: Phase → Angebot, Nachfassen am 10.11.“.
  - Bitte `nextAction` zusätzlich maschinenlesbar liefern: `{ title, dueAt }`.
- **Rückkanal für Lerneffekte:** Bitte ein Webhook `signal.proposal_resolved` `{ signalId, accepted: true|false }`. Lehnen Nutzer Vorschläge ab, kann Mailwin seine Schwellen anpassen.

**Offene Fragen der Mailwin-Seite, beantwortet:**

| Frage | Antwort |
|---|---|
| Sieht Mailwin ausgehende Mails? | Ja. Gesendet wird über Mailwin oder per Abruf des Ordners „Gesendet“ (Gmail, Microsoft 365, IMAP). |
| Stabile IDs? | Ja: Mailwin-UUIDs je Konversation und Nachricht (siehe oben). |
| Wie erkennt Mailwin ein Angebot? | **Zweistufig.** (1) Günstige Vorfilter: ausgehende Mail mit PDF-Anhang, dessen Name auf Angebot/Offer/Quote/KVA/Kostenvoranschlag plus Nummer passt, oder Formulierungen wie „anbei unser Angebot“. (2) Nur für Treffer eine Einordnung durch das Sprachmodell mit fester Antwortstruktur: `signal`, `confidence`, wörtliches Zitat, `data`. Annahme oder Absage erkennt nur das Modell, Schlüsselwörter sind dafür zu unzuverlässig. |
| Realistische Verlässlichkeit? | Anfangs **Schätzwerte des Modells, nicht kalibriert.** Grobe Erwartung: eindeutige Fälle (Angebot als PDF mit Nummer, „Wir nehmen Ihr Angebot an“) 0,85–0,95; nur Vorfilter ohne Modellbestätigung ≤ 0,7; vage Zusagen („klingt gut, wir melden uns“) 0,4–0,6. Mailwin sendet erst ab **0,6**. Kalibrieren können wir mit dem Rückkanal oben. |
| WhatsApp-IDs stabil? | Ja. Die Cloud API vergibt je Nachricht eine stabile `wamid.…`. Mailwin speichert sie intern und sendet wie bei E-Mail eigene UUIDs (`threadId` = Chat mit einer Kundennummer, `messageId` = Nachricht, `externalId` = `whatsapp:<id>`). |

**Zu euren Produktentscheidungen (Empfehlung aus Mailwin-Sicht):**
- **„Angebot angenommen“** bleibt standardmäßig ein **Vorschlag**. „Automatisch gewonnen“ nur als ausdrückliche Einstellung des Arbeitsbereichs, mit Schwelle (z. B. ≥ 0,9) und nur, wenn Mailwin ein wörtliches Zitat mitschickt.
- **`offer_sent` überschreibt den Deal-Wert nie stillschweigend:**
  - Ist der Wert leer, wird er übernommen.
  - Weicht er ab, gibt es einen Vorschlag „Wert auf 24.000 € aktualisieren?“.
  - Von Hand gepflegte Werte haben Vorrang.

**Zu den weiteren Bausteinen:**
- **`GET /leads/{id}`:** hoher Nutzen für Antwortentwürfe. Bitte mit Owner-Name, `nextAction`, offenen Aufgaben und den letzten fünf Aktivitäten.
- **`POST /tasks`:** ja, mit `dueAt` (mit Zone), `externalId` für Idempotenz und `leadId`/`contactId`.
- **`POST /contacts/{id}/suggestions`:** ja. Mailwin liefert Telefon, Position und Adresse aus Signaturen, je mit Zitat.
- **`POST /outreach/replies`:** Für die Zuordnung zur Sequenz schlage ich vor, dass Mailwin `inReplyTo` und `references` (RFC-Message-IDs der Antwort) mitsendet. Das CRM gleicht sie mit den Message-IDs seiner versendeten Sequenz-Mails ab. So braucht es keine weitere Suche.
- **`lead.next_action_due`:** sehr gut. Mailwin legt dann im zugeordneten Thread einen Nachfass-**Entwurf zur Freigabe** an, ohne automatischen Versand.

## 5. Was ich für den Test gegen eure Instanz brauche

1. Die **Adresse der Testinstanz** und einen **Sandbox-Schlüssel** (`pnpm mailwin:sandbox`). Den Schlüssel bitte nicht in einen Chat kopieren. Der Kunde bzw. OKUN trägt ihn direkt in Mailwin unter Einstellungen → CRM-Anbindung ein.
2. In der Sandbox als Webhook-Ziel die Adresse, die Mailwin dort anzeigt (`https://okun-mailwin.com/api/integrations/okun-crm/webhook?i=…`), dazu das Geheimnis aus Mailwin.
3. Dann prüfen wir Ende zu Ende:
   - Erikas Anfrage als Lead anlegen bzw. „Rahmenvertrag 2027“ zuordnen.
   - Antwort am Lead: Nachfassen stoppt im CRM.
   - Phasenwechsel und „Gewonnen“ im CRM: Anzeige und Benachrichtigung in Mailwin.
