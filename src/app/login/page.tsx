import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { integrations } from "@/lib/env";
import { Brand } from "@/components/Brand";
import { MarvinPointing } from "@/components/Marvin";

export const metadata = { title: "Anmelden" };

const ERRORS: Record<string, string> = {
  google_nicht_konfiguriert: "Die Google-Anmeldung ist auf diesem Server noch nicht eingerichtet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen).",
  zugriff_verweigert: "Du hast den Zugriff bei Google abgelehnt. Ohne Zugriff kann Marvin dein Postfach nicht bearbeiten.",
  sitzung_abgelaufen: "Die Anmeldung hat zu lange gedauert. Bitte versuche es noch einmal.",
  ungueltiger_status: "Die Anmeldung konnte nicht bestätigt werden. Bitte versuche es noch einmal.",
  email_nicht_bestaetigt: "Die E-Mail-Adresse dieses Google-Kontos ist nicht bestätigt.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { fehler } = await searchParams;
  return (
    <div className="login">
      <div className="visual">
        <Image src="/brand/buero-hintergrund.webp" alt="" fill priority className="bg" sizes="55vw" />
        <div className="robot">
          <MarvinPointing width={520} priority />
        </div>
      </div>
      <div className="form">
        <Brand />
        <h1 style={{ fontSize: 34, letterSpacing: "-0.02em" }}>
          Dein KI-Assistent für <span style={{ color: "var(--mw-green-600)" }}>E-Mail, Termine und Projekte.</span>
        </h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Du kümmerst dich um deine Ziele. Marvin kümmert sich um deine E-Mails und die damit verbundenen Aufgaben.
        </p>
        {fehler && <div className="notice error">{ERRORS[fehler] ?? "Die Anmeldung ist fehlgeschlagen."}</div>}
        {integrations.google ? (
          <a className="google-btn" href="/api/auth/google/start">
            <GoogleLogo /> Mit Google anmelden
          </a>
        ) : (
          <div className="notice warn">{ERRORS.google_nicht_konfiguriert}</div>
        )}
        <p className="small muted">
          Mailwin fragt nur die nötigen Berechtigungen an: E-Mails lesen und organisieren, E-Mails senden (immer erst nach deiner Freigabe) und deinen Kalender
          lesen. Dauerhaftes Löschen ist technisch ausgeschlossen. Zugangsdaten werden verschlüsselt gespeichert.
        </p>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
