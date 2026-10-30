import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db";
import { randomToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "mw_session";
const SESSION_DAYS = 30;

export type SessionUser = typeof schema.users.$inferSelect;
export type Session = typeof schema.sessions.$inferSelect;

export async function createSession(userId: string, opts: { twoFactorVerified: boolean }): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(schema.sessions).values({ tokenHash: sha256(token), userId, expiresAt, twoFactorVerified: opts.twoFactorVerified, userAgent });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Rohzustand der Sitzung – auch halbfertige (2FA ausstehend). */
export async function getSessionState(): Promise<{ user: SessionUser; session: Session } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!row || row.user.status !== "active") return null;
  return row;
}

/** Vollständig angemeldeter Nutzer (2FA erledigt) oder null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const state = await getSessionState();
  return state && state.session.twoFactorVerified ? state.user : null;
}

/** Für Seiten und Server Actions: leitet je nach Zustand zu Anmeldung, 2FA oder Passwortwechsel. */
export async function requireUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (!state.session.twoFactorVerified) redirect("/login/code");
  if (state.user.mustChangePassword) redirect("/passwort-aendern");
  return state.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function markSessionVerified(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.update(schema.sessions).set({ twoFactorVerified: true }).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  store.delete(SESSION_COOKIE);
}

/** Alle Sitzungen eines Nutzers beenden (Passwortwechsel, Sperre, „überall abmelden“). */
export async function destroyAllSessions(userId: string, exceptCurrent = false): Promise<void> {
  const current = exceptCurrent ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  const rows = await db.select({ tokenHash: schema.sessions.tokenHash }).from(schema.sessions).where(eq(schema.sessions.userId, userId));
  for (const r of rows) {
    if (current && r.tokenHash === sha256(current)) continue;
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, r.tokenHash));
  }
}
