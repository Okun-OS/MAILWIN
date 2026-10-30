import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { integrations } from "@/lib/env";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/forms";

export const metadata = { title: "Anmelden" };

const ERRORS: Record<string, string> = {
  google_nicht_konfiguriert: "Die Google-Anmeldung ist auf diesem Server noch nicht eingerichtet.",
  zugriff_verweigert: "Du hast den Zugriff bei Google abgelehnt.",
  sitzung_abgelaufen: "Die Anmeldung hat zu lange gedauert. Bitte versuche es noch einmal.",
  ungueltiger_status: "Die Anmeldung konnte nicht bestätigt werden. Bitte versuche es noch einmal.",
  email_nicht_bestaetigt: "Die E-Mail-Adresse dieses Google-Kontos ist nicht bestätigt.",
  kein_konto: "Zu diesem Google-Konto gibt es noch keinen Mailwin-Zugang. Bitte melde dich mit deinen Zugangsdaten an.",
  konto_gesperrt: "Dieses Konto ist gesperrt. Bitte wende dich an den Support.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fehler?: string; zurueckgesetzt?: string }> }) {
  const state = await getSessionState();
  if (state?.session.twoFactorVerified) redirect("/");
  if (state) redirect("/login/code");
  const sp = await searchParams;
  return (
    <AuthShell
      title={
        <>
          Willkommen zurück bei <span style={{ color: "var(--mw-green-600)" }}>Mailwin.</span>
        </>
      }
      subtitle="Melde dich mit deinen Zugangsdaten an."
    >
      {sp.fehler && <div className="notice error">{ERRORS[sp.fehler] ?? "Die Anmeldung ist fehlgeschlagen."}</div>}
      {sp.zurueckgesetzt && <div className="notice">Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.</div>}
      <LoginForm />
      {integrations.google && (
        <>
          <div className="small muted" style={{ textAlign: "center" }}>oder</div>
          <a className="google-btn" href="/api/auth/google/start">
            <GoogleLogo /> Mit Google anmelden
          </a>
        </>
      )}
    </AuthShell>
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
