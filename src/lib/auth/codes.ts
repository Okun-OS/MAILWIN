import { createHmac, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { randomToken } from "../crypto";
import { requireEnv } from "../env";

type Purpose = (typeof schema.authCodes.$inferSelect)["purpose"];

const CODE_TTL_MIN = 10;
const RESET_TTL_MIN = 60;
const MAX_ATTEMPTS = 5;

/** HMAC statt reinem Hash: Kurze Zahlencodes ließen sich sonst bei einem DB-Leck durchprobieren. */
function digest(value: string) {
  return createHmac("sha256", requireEnv("ENCRYPTION_KEY")).update(value).digest("hex");
}

/** Erzeugt einen 6-stelligen Code. Ältere offene Codes desselben Zwecks werden ungültig. */
export async function issueCode(userId: string, purpose: Purpose, opts: { channel?: "email" | "sms"; target?: string } = {}) {
  await invalidate(userId, purpose);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(schema.authCodes).values({
    userId,
    purpose,
    codeHash: digest(code),
    channel: opts.channel ?? null,
    target: opts.target ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000),
  });
  return code;
}

/** Prüft einen Code. Liefert den Eintrag (z. B. mit `target`) oder null. Max. 5 Versuche. */
export async function consumeCode(userId: string, purpose: Purpose, code: string) {
  const [row] = await db
    .select()
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.userId, userId), eq(schema.authCodes.purpose, purpose), isNull(schema.authCodes.usedAt), gt(schema.authCodes.expiresAt, new Date())))
    .orderBy(desc(schema.authCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) return null;
  if (row.codeHash !== digest(code.replace(/\s/g, ""))) {
    await db.update(schema.authCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.authCodes.id, row.id));
    return null;
  }
  await db.update(schema.authCodes).set({ usedAt: new Date() }).where(eq(schema.authCodes.id, row.id));
  return row;
}

/** Passwort-Reset-Link: langes Zufallstoken, enthält die Code-ID, damit kein Nutzer gesucht werden muss. */
export async function issueResetToken(userId: string) {
  await invalidate(userId, "password_reset");
  const secret = randomToken(32);
  const [row] = await db
    .insert(schema.authCodes)
    .values({ userId, purpose: "password_reset", codeHash: digest(secret), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) })
    .returning({ id: schema.authCodes.id });
  return `${row!.id}.${secret}`;
}

export async function resolveResetToken(token: string, consume: boolean) {
  const [id, secret] = token.split(".");
  if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await db
    .select()
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.id, id), eq(schema.authCodes.purpose, "password_reset"), isNull(schema.authCodes.usedAt), gt(schema.authCodes.expiresAt, new Date())));
  if (!row || row.codeHash !== digest(secret)) return null;
  if (consume) await db.update(schema.authCodes).set({ usedAt: new Date() }).where(eq(schema.authCodes.id, row.id));
  return row;
}

export async function invalidate(userId: string, purpose: Purpose) {
  await db
    .update(schema.authCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.authCodes.userId, userId), eq(schema.authCodes.purpose, purpose), isNull(schema.authCodes.usedAt)));
}
