import Link from "next/link";
import { resolveResetToken } from "@/lib/auth/codes";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetForm } from "@/components/auth/forms";

export const metadata = { title: "Neues Passwort" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = token ? await resolveResetToken(token, false) : null;
  return (
    <AuthShell title="Neues Passwort festlegen">
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <>
          <div className="notice error">Dieser Link ist ungültig oder abgelaufen.</div>
          <Link href="/passwort-vergessen" className="link-more">Neuen Link anfordern</Link>
        </>
      )}
    </AuthShell>
  );
}
