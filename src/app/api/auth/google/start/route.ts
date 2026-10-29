import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { CodeChallengeMethod } from "google-auth-library";
import { oauthClient, GOOGLE_SCOPES } from "@/lib/auth/google-oauth";
import { integrations } from "@/lib/env";
import { randomToken } from "@/lib/crypto";

/** Startet Anmeldung bzw. das Verbinden eines weiteren Gmail-Kontos (OAuth 2 mit PKCE). */
export async function GET(req: NextRequest) {
  if (!integrations.google) {
    return NextResponse.redirect(new URL("/login?fehler=google_nicht_konfiguriert", req.url));
  }
  const client = oauthClient();
  const state = randomToken(24);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const intent = req.nextUrl.searchParams.get("intent") === "connect" ? "connect" : "login";

  const store = await cookies();
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  store.set("mw_oauth", JSON.stringify({ state, codeVerifier, intent }), cookie);

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // sorgt dafür, dass Google ein Refresh-Token ausgibt
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  return NextResponse.redirect(url);
}
