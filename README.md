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
