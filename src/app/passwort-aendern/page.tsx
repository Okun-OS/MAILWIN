import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/AuthShell";
import { ChangePasswordForm } from "@/components/auth/forms";
import { cancelLoginAction } from "../login/actions";

export const metadata = { title: "Passwort ändern" };

/** Pflicht-Passwortwechsel nach Startpasswort oder vom Admin vergebenem Passwort. */
export default async function MustChangePage() {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (!state.session.twoFactorVerified) redirect("/login/code");
  if (!state.user.mustChangePassword) redirect("/einstellungen#sicherheit");
  return (
    <AuthShell title="Bitte lege dein eigenes Passwort fest" subtitle="Du hast dich mit einem vorläufigen Passwort angemeldet. Wähle jetzt ein persönliches Passwort.">
      <ChangePasswordForm requireCurrent={Boolean(state.user.passwordHash)} submitLabel="Passwort speichern und weiter" />
      <form action={cancelLoginAction}>
        <button className="btn btn-ghost btn-sm">Abmelden</button>
      </form>
    </AuthShell>
  );
}
