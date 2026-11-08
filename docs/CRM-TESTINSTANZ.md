# OKUN CRM: Testinstanz einrichten und mit Mailwin testen

Diese Anleitung beschreibt die Schritte, die nur du machen kannst (Zugang zu Railway, Schlüssel eintragen). Schlüssel und Geheimnisse kommen nie in einen Chat und nie in ein Repository.

## 1. Testumgebung für das CRM auf Railway

1. Öffne das **Railway-Projekt des CRM**.
2. Oben in der Leiste das Umgebungs-Menü öffnen (dort steht „production“) und **„+ New Environment“** wählen. Alternativ unter *Settings → Environments*.
3. Name `test`, Art **„Duplicate Environment“** von `production`. Railway kopiert Dienste, Variablen und Einstellungen und legt die Änderungen zur Freigabe bereit. Noch **nicht** auf „Deploy“ klicken.
4. **Bevor du deployst, die Variablen des CRM-Dienstes in der Umgebung `test` prüfen:**
   - **`DATABASE_URL`** muss eine **Referenz** sein, also `${{Postgres.DATABASE_URL}}`. Steht dort eine ausgeschriebene Verbindung (`postgresql://…`), zeigt die Testinstanz auf die **Produktionsdatenbank**. Dann auf die Referenz umstellen.
   - **`APP_URL`** wird erst in Schritt 6 auf die neue Adresse gesetzt.
   - E-Mail-Versand: Ist `RESEND_API_KEY` gesetzt, die Variable in `test` entfernen, damit die Testinstanz keine echten E-Mails verschickt.
5. Jetzt die Änderungen freigeben (**Deploy**).
6. Im CRM-Dienst der Umgebung `test`:
   - Unter *Settings → Networking* auf **„Generate Domain“** klicken. Das ist die **Adresse der Testinstanz**, etwa `https://crm-test-xxxx.up.railway.app`.
   - Diese Adresse als **`APP_URL`** des CRM-Dienstes in `test` eintragen. Railway deployt dann neu.
7. **Prüfen, dass die Datenbank leer ist.** Die Railway-Doku sagt nicht ausdrücklich, ob Datenbankinhalte beim Duplizieren mitkommen. Im Postgres-Dienst der Umgebung `test` unter *Data* nachsehen: Es darf keine Kunden-Organisation geben. Wenn doch, die Testumgebung löschen und als **„Empty Environment“** neu aufbauen.
8. **Die Adresse dem CRM-Chat schicken.** Sie ist kein Geheimnis.

## 2. Sandbox-Schlüssel erzeugen

**Weg A – Railway-Konsole** (wie vom CRM vorgeschlagen):
- Im CRM-Dienst der Umgebung `test` die Konsole öffnen und `pnpm mailwin:sandbox` ausführen.
- Ausgegeben werden: Arbeitsbereich „Mailwin Sandbox“, Basis-URL, **API-Schlüssel** (`okun_mw_…`) und ein Login für die Sandbox.
- Fehlt in der Konsole `pnpm` oder `npm` (bei Mailwin war das so), nimm Weg B.

**Weg B – über die Oberfläche** (immer möglich):
1. `https://<Testinstanz>/register` öffnen und ein Konto anlegen. Das ist dein Test-Arbeitsbereich.
2. Einen Kontakt „Erika Muster“, eine Firma „Beispiel AG“ und einen Lead „Rahmenvertrag 2027“ in Phase „Qualifiziert“ anlegen.
3. *Einstellungen → Integrationen → Mailwin → Schlüssel erzeugen.* Der Schlüssel wird nur einmal angezeigt.

**Wichtig für den echten Test:**
- Mailwin ordnet über die **Absenderadresse** zu. `erika@beispiel-ag.de` kann keine echten E-Mails schicken.
- Ändere deshalb die E-Mail-Adresse von Erika im Test-CRM auf ein Postfach, aus dem du wirklich schreiben kannst, zum Beispiel ein privates Zweitpostfach.
- Es darf nicht das Postfach sein, das in Mailwin verbunden ist.

## 3. Mailwin mit der Testinstanz verbinden

1. In Mailwin (okun-mailwin.com) mit dem Konto anmelden, dessen Postfach die Test-Mails empfangen soll.
2. *Einstellungen → CRM-Anbindung*:
   - **Adresse des CRM:** die Adresse der Testinstanz
   - **API-Schlüssel:** aus Schritt 2
   - Dann **„CRM verbinden“** klicken. Mailwin zeigt „Mailwin Sandbox“ bzw. deinen Arbeitsbereich an.
3. Unter **„Rückmeldungen vom CRM (Webhook)“**:
   - Die **Webhook-Adresse** kopieren (`…/api/integrations/okun-crm/webhook?i=…`).
   - **„Hier erzeugen“** klicken und das **Geheimnis** kopieren. Es wird nur einmal angezeigt.
4. Im Test-CRM unter *Einstellungen → Integrationen → Mailwin → Webhooks*:
   - Adresse und Geheimnis eintragen.
   - **„Testereignis senden“** klicken.
   - In Mailwin steht danach unter „Rückmeldungen“: „aktiv, zuletzt …“.
5. In Mailwin die Einstellungen so lassen: „Nur zugeordnete Konversationen“, Vorschau, Leads mit Freigabe, Signale **an**.

## 4. Ende-zu-Ende-Test

| Schritt | Was du tust | Was du siehst |
|---|---|---|
| 1 | Von „Erikas“ Adresse eine Anfrage an dein Mailwin-Postfach schicken | Nach höchstens 2 Minuten erscheint sie in Mailwin. Die CRM-Karte zeigt Erika mit „Rahmenvertrag 2027“. |
| 2 | „Diesem Lead zuordnen“ (oder „Als Lead anlegen“) | Im CRM steht die Nachricht in der Zeitleiste des Leads, mit Link „In Mailwin öffnen“. |
| 3 | Aus Mailwin antworten, dann mit „Erika“ erneut antworten | Beide Nachrichten erscheinen am Lead. Die Antwort zählt als Kundenreaktion, und geplantes Nachfassen entfällt. |
| 4 | Eine Antwort mit Anhang `Angebot_2026-117.pdf` und Text „anbei unser Angebot über 24.000 €“ schicken | Signal „Angebot verschickt“: Phase „Angebot“, „Angebot nachfassen“ geplant, Wert übernommen. Die Karte zeigt die Meldung und den nächsten Schritt. |
| 5 | Als „Erika“ antworten: „Wir nehmen Ihr Angebot an.“ | Im CRM erscheint der Vorschlag „Als gewonnen markieren?“ mit Zitat. In Mailwin steht er als „wartet im CRM“. |
| 6 | Den Vorschlag im CRM **verwerfen** | In Mailwin steht er als „verworfen“ (`signal.proposal_resolved`). |
| 7 | Als „Erika“ eine Abwesenheitsnotiz schicken (Betreff „Automatische Antwort: …“, Text „Ich bin bis 20.11. nicht im Büro“) | Im CRM wird das Nachfassen bis 20.11. pausiert. Das zählt **nicht** als Kundenantwort. |
| 8 | Im CRM die Phase ändern, dann auf „Gewonnen“ setzen | In Mailwin wechselt die Phase, und es kommt die Benachrichtigung „Gewonnen: …“. |
| 9 | Einen zweiten Test-Lead zuordnen und im CRM **löschen** | In Mailwin bleibt die Konversation nur dem Kontakt zugeordnet, mit der Benachrichtigung „Lead im CRM gelöscht“. |
| 10 | Optional: im CRM eine Nachfass-Aktion auf „jetzt fällig“ setzen | Mailwin legt über Marvin einen **Entwurf zur Freigabe** an (Benachrichtigung „Nachfassen fällig“). Gesendet wird nichts. |

Läuft etwas nicht wie beschrieben, notiere Schritt, Uhrzeit und was du siehst. Die Gegenstellen protokollieren beide: das Aktivitätsprotokoll in Mailwin und das Aufrufprotokoll der Schnittstelle im CRM.

**Erst danach** verbindest du die Produktion auf dieselbe Weise, mit einem Schlüssel aus deinem echten Arbeitsbereich. In Mailwin genügt dafür „API-Schlüssel ersetzen“ mit der Produktionsadresse. Zuordnungen aus dem Test werden dabei gelöscht, weil es ein anderer Arbeitsbereich ist.

## 5. Resend (Einladungen, 2FA-Codes, Passwort-Links)

1. **resend.com → Domains → Add Domain**: `okun-mailwin.com`.
2. Resend zeigt die nötigen DNS-Einträge. Jeden genau so bei **Squarespace → Domains → okun-mailwin.com → DNS → Custom Records** anlegen:
   - meist ein TXT-Eintrag unter `resend._domainkey`
   - ein MX- und ein TXT-Eintrag unter `send`
3. Die bestehenden Einträge für `@` (ALIAS zu Railway) nicht anfassen.
4. In Resend auf **Verify** klicken. Die Prüfung kann einige Minuten dauern.
5. In Resend unter *API Keys* einen Schlüssel mit **Sending access** erzeugen.
6. In Railway im **Mailwin-Projekt** als Shared Variables für Web und Worker eintragen:
   - `RESEND_API_KEY` = der Schlüssel (nur dort eintragen, nicht in den Chat)
   - `MAIL_FROM` = `Mailwin <noreply@okun-mailwin.com>`
7. Prüfen:
   - Im Admin unter *System* steht „E-Mail-Versand (Resend)“ auf grün.
   - „Passwort vergessen“ mit deiner Adresse ausprobieren.

Für das CRM gilt dasselbe mit dessen eigener Domain und Absenderadresse, in dessen Railway-Projekt. In der Testumgebung des CRM bleibt Resend aus (siehe 1.4).
