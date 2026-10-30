import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { exchangeMicrosoftCode } from "@/lib/auth/microsoft-oauth";
import { hasFeature } from "@/lib/features";
import { enqueue } from "@/lib/jobs/queue";

const fail = (code: string) => NextResponse.redirect(appUrl(`/einstellungen?fehler=${code}`));

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const store = await cookies();
  const raw = store.get("mw_ms_oauth")?.value;
  store.delete("mw_ms_oauth");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("microsoft_abgelehnt");
  if (!raw) return fail("microsoft_sitzung");
  const saved = JSON.parse(raw) as { state: string; verifier: string };
  if (params.get("state") !== saved.state) return fail("microsoft_sitzung");

  let tokens;
  try {
    tokens = await exchangeMicrosoftCode(params.get("code") ?? "", saved.verifier);
  } catch {
    return fail("microsoft_fehler");
  }
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!meRes.ok) return fail("microsoft_fehler");
  const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
  const email = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
  if (!email.includes("@")) return fail("microsoft_fehler");

  const existing = await db.select({ email: schema.connectedAccounts.emailAddress }).from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id));
  if (existing.length && !existing.some((a) => a.email === email) && !hasFeature(user, "additional_mailboxes")) return fail("weitere_postfaecher");

  const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  const values = {
    accessTokenEnc: encrypt(tokens.access_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes,
    status: "active" as const,
    lastError: null,
    displayName: me.displayName ?? null,
    calendarEnabled: scopes.some((s) => s.toLowerCase().endsWith("calendars.read")),
    updatedAt: new Date(),
    ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
  };
  const [account] = await db
    .insert(schema.connectedAccounts)
    .values({ userId: user.id, provider: "microsoft", emailAddress: email, ...values })
    .onConflictDoUpdate({ target: [schema.connectedAccounts.userId, schema.connectedAccounts.provider, schema.connectedAccounts.emailAddress], set: values })
    .returning();
  await audit({ userId: user.id, accountId: account!.id, actor: "user", action: "connect_account", status: "success", details: { provider: "microsoft" } });
  await enqueue("sync_account", { accountId: account!.id }, { dedupeKey: `sync:${account!.id}` });
  return NextResponse.redirect(appUrl("/einstellungen?verbunden=1"));
}
