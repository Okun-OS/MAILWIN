import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotForm } from "@/components/auth/forms";

export const metadata = { title: "Passwort vergessen" };

export default function ForgotPage() {
  return (
    <AuthShell title="Passwort vergessen?" subtitle="Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.">
      <ForgotForm />
    </AuthShell>
  );
}
