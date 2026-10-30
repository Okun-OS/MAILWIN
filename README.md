# OKUN Mailwin

Dein persönlicher KI-E-Mail-Beauftragter. **Marvin** liest, organisiert und beantwortet deine E-Mails, plant Projekte und hält den Überblick. Versendet wird immer erst nach deiner Freigabe.

- Architektur: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)
- Umsetzungsstand: [docs/STATUS.md](docs/STATUS.md)
- Designreferenz: [docs/design/dashboard-referenz.png](docs/design/dashboard-referenz.png)

## Stack

Next.js 16 (App Router, TypeScript) · PostgreSQL + Drizzle ORM · eigener Job-Worker · Gmail- und Calendar-API · Claude API (`@anthropic-ai/sdk`) · Vitest

## Lokal starten

Voraussetzungen: Node 22 und PostgreSQL 16.

```bash
npm install
cp .env.example .env      # Werte eintragen, siehe unten
createdb mailwin          # oder DATABASE_URL auf eine bestehende DB zeigen lassen
npm run db:migrate
npm run dev               # Web-App auf http://localhost:3000
npm run worker            # zweites Terminal: Synchronisation & Hintergrundjobs
```

### Konfiguration (`.env`)

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung |
| `ENCRYPTION_KEY` | 32 Byte base64 – verschlüsselt OAuth-Tokens. Erzeugen: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth-Client (Typ „Webanwendung“) in der Google Cloud Console. Gmail-API und Calendar-API aktivieren, Redirect-URI `http://localhost:3000/api/auth/google/callback` eintragen, eigene Adresse als Testnutzer hinterlegen. |
| `ANTHROPIC_API_KEY` | Für Marvin |
| `APP_URL` | Basis-URL (für OAuth-Redirects) |

## Deployment auf Railway

Mailwin braucht drei Bausteine im selben Railway-Projekt:

1. **PostgreSQL**: über „New → Database → PostgreSQL“ anlegen.
2. **Web-Service** (dieses Repository):
   - *Settings → Source*: Branch mit dem Code wählen. **Auf `main` liegt bisher nur `.gitkeep`**, ein Build von dort schlägt fehl.
   - Migrationen laufen automatisch beim Start (`npm start`), ein Pre-Deploy-Befehl ist nicht nötig.
   - *Settings → Deploy → Healthcheck Path*: `/api/health`
   - Start und Build erkennt Railpack automatisch (`npm run build`, `npm start`; `PORT` wird übernommen).
   - Einen Domain-Namen erzeugen und als `APP_URL` eintragen.
3. **Worker-Service**: dasselbe Repository und derselbe Branch noch einmal hinzufügen, mit *Custom Start Command* `npm run worker` und ohne Domain. Der Worker synchronisiert die Postfächer, auch wenn niemand die Seite geöffnet hat.

Variablen für **beide** Services (am einfachsten als *Shared Variables*):

| Variable | Wert |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Referenz auf die Railway-Datenbank) |
| `ENCRYPTION_KEY` | einmal erzeugen (siehe oben) und **nie wieder ändern**, sonst sind gespeicherte Tokens unlesbar |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | aus der Google Cloud Console; Redirect-URI `https://<deine-domain>/api/auth/google/callback` |
| `ANTHROPIC_API_KEY` | für Marvin |
| `APP_URL` | `https://<deine-domain>` |
| `ADMIN_EMAIL` | Admin-Zugang (Standard `kontakt@okun-systems.com`) |
| `ADMIN_INITIAL_PASSWORD` | Startpasswort des Admins, mind. 10 Zeichen. Wird nur gesetzt, solange noch kein Passwort existiert; beim ersten Login muss es geändert werden. |
| `RESEND_API_KEY`, `MAIL_FROM` | System-E-Mails (2FA-Codes, Passwort-Links, Einladungen), z. B. `MAIL_FROM=Mailwin <noreply@okun-mailwin.com>` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS-Codes; `TWILIO_FROM` = Absendernummer (+49…) oder Messaging-Service-SID (MG…) |
| `ALLOW_GOOGLE_SIGNUP` | `true` erlaubt Selbstregistrierung per Google (Standard: aus) |

## Tests

```bash
createdb mailwin_test     # einmalig; alternativ TEST_DATABASE_URL setzen
npm test                  # Unit- und Integrationstests (Fake-Mailanbieter, Fake-Modell)
npm run typecheck
```

## Projektstruktur

```
src/app/(app)/        Seiten (Dashboard, E-Mails, Marvin, Projekte, …) und Server Actions
src/components/       UI-Komponenten (Dashboard, Marvin, Freigabekarten)
src/lib/mail/         Anbieter-Interface, Gmail-Adapter, MIME, Sync, Aktionen
src/lib/marvin/       Agenten-Loop, Tools, Berechtigungen, System-Prompt
src/lib/approvals.ts  Freigaben – einzige Stelle, an der Marvin-Aktionen ausgeführt werden
src/lib/jobs/, src/worker/  Warteschlange und Hintergrund-Worker
src/lib/db/schema.ts  Datenmodell
public/brand/         Marvin-Icon, Marvin-Figur, Header- und Bürohintergrund
```
