import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { maskTarget } from "@/lib/auth/twofactor";
import { AuthShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/forms";
import { cancelLoginAction } from "../actions";

export const metadata = { title: "Anmeldecode" };

export default async function CodePage() {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.session.twoFactorVerified) redirect("/");
  const { user } = state;
  const hint =
    user.twoFactorMethod === "sms" && user.phone
      ? `Wir haben dir per SMS einen 6-stelligen Code an ${maskTarget(user.phone)} geschickt.`
      : `Wir haben dir einen 6-stelligen Code an ${maskTarget(user.email)} geschickt.`;
  return (
    <AuthShell title="Bestätige deine Anmeldung" subtitle="Zweiter Schritt zum Schutz deines Kontos.">
      <CodeForm hint={hint} />
      <form action={cancelLoginAction}>
        <button className="btn btn-ghost btn-sm">Abbrechen und zurück</button>
      </form>
    </AuthShell>
  );
}
