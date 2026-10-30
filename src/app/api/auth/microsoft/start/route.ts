import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { appUrl, integrations } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { microsoftAuthUrl } from "@/lib/auth/microsoft-oauth";

/** Verbindet ein Microsoft-365-/Outlook-Postfach mit dem angemeldeten Konto (OAuth 2 + PKCE). */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.redirect(appUrl("/login"));
  if (!integrations.microsoft) return NextResponse.redirect(appUrl("/einstellungen?fehler=microsoft_nicht_konfiguriert"));
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  (await cookies()).set("mw_ms_oauth", JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(microsoftAuthUrl(state, challenge));
}
