import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { db, schema } from "@/lib/db";
import { oauthClient } from "@/lib/auth/google-oauth";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";

function fail(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/login?fehler=${code}`, req.url));
}

export async function GET(req: NextRequest) {
  const store = await cookies();
  const raw = store.get("mw_oauth")?.value;
  store.delete("mw_oauth");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(req, "zugriff_verweigert");
  if (!raw) return fail(req, "sitzung_abgelaufen");

  const saved = JSON.parse(raw) as { state: string; codeVerifier: string; intent: "login" | "connect" };
  if (!params.get("state") || params.get("state") !== saved.state) return fail(req, "ungueltiger_status");

  const client = oauthClient();
  const { tokens } = await client.getToken({ code: params.get("code") ?? "", codeVerifier: saved.codeVerifier });
  client.setCredentials(tokens);
  const { data: profile } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  if (!profile.email || !profile.verified_email) return fail(req, "email_nicht_bestaetigt");
  const email = profile.email.toLowerCase();

  // Angemeldeter Nutzer verbindet ein weiteres Konto – sonst Anmeldung/Registrierung über dieses Konto
  let user = saved.intent === "connect" ? await getCurrentUser() : null;
  if (!user) {
    const [row] = await db
      .insert(schema.users)
      .values({ email, name: profile.name ?? null, avatarUrl: profile.picture ?? null })
      .onConflictDoUpdate({ target: schema.users.email, set: { avatarUrl: profile.picture ?? null, updatedAt: new Date() } })
      .returning();
    user = row!;
    await createSession(user.id);
  }

  const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  const tokenValues = {
    accessTokenEnc: tokens.access_token ? encrypt(tokens.access_token) : null,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes,
    status: "active" as const,
    lastError: null,
    displayName: profile.name ?? null,
    calendarEnabled: scopes.includes("https://www.googleapis.com/auth/calendar.readonly"),
    updatedAt: new Date(),
    ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
  };
  const [account] = await db
    .insert(schema.connectedAccounts)
    .values({ userId: user.id, provider: "gmail", emailAddress: email, ...tokenValues })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.provider, schema.connectedAccounts.emailAddress],
      set: tokenValues,
    })
    .returning();

  await audit({ userId: user.id, accountId: account!.id, actor: "user", action: "connect_account", status: "success", details: { provider: "gmail", scopes } });
  await enqueue("sync_account", { accountId: account!.id }, { dedupeKey: `sync:${account!.id}` });

  return NextResponse.redirect(new URL(saved.intent === "connect" ? "/einstellungen?verbunden=1" : "/", req.url));
}
