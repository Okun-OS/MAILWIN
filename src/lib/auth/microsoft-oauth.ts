import { env, requireEnv } from "../env";

/**
 * Microsoft Entra ID (Azure AD) – OAuth 2.0 mit PKCE. „common“ erlaubt Firmenkonten (Microsoft 365)
 * und private Konten (Outlook.com/Hotmail).
 */
export const MICROSOFT_SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.Read"];

const base = () => `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0`;
export const microsoftRedirectUri = () => `${env.APP_URL}/api/auth/microsoft/callback`;

export function microsoftAuthUrl(state: string, codeChallenge: string) {
  const p = new URLSearchParams({
    client_id: requireEnv("MICROSOFT_CLIENT_ID"),
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${base()}/authorize?${p}`;
}

export interface MicrosoftTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export class MicrosoftAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function tokenRequest(params: Record<string, string>): Promise<MicrosoftTokens> {
  const res = await fetch(`${base()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requireEnv("MICROSOFT_CLIENT_ID"), client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"), ...params }),
  });
  const data = (await res.json()) as MicrosoftTokens & { error?: string; error_description?: string };
  if (!res.ok || data.error) throw new MicrosoftAuthError(data.error ?? String(res.status), data.error_description ?? "Microsoft-Anmeldung fehlgeschlagen.");
  return data;
}

export const exchangeMicrosoftCode = (code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: microsoftRedirectUri(), code_verifier: verifier, scope: MICROSOFT_SCOPES.join(" ") });

export const refreshMicrosoftToken = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: MICROSOFT_SCOPES.join(" ") });
