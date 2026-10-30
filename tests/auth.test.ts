import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generatePassword, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { consumeCode, issueCode, issueResetToken, resolveResetToken } from "@/lib/auth/codes";
import { normalizePhone } from "@/lib/auth/twofactor";
import { ensureAdmin } from "@/lib/auth/bootstrap";
import { env } from "@/lib/env";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function user(email = "a@test.de") {
  const [u] = await db.insert(schema.users).values({ email }).returning();
  return u!;
}

describe("Passwörter", () => {
  it("hasht mit Salz und prüft korrekt", async () => {
    const h = await hashPassword("ein langes Passwort");
    expect(h).toMatch(/^scrypt\$/);
    expect(h).not.toBe(await hashPassword("ein langes Passwort"));
    expect(await verifyPassword("ein langes Passwort", h)).toBe(true);
    expect(await verifyPassword("falsch", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
  it("prüft Mindestanforderungen", () => {
    expect(passwordProblem("kurz")).toMatch(/10 Zeichen/);
    expect(passwordProblem("felix1234567", "felix@okun.de")).toMatch(/E-Mail/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/einfach/);
    expect(passwordProblem("Sonnenblume im Garten")).toBeNull();
    expect(passwordProblem(generatePassword())).toBeNull();
  });
});

describe("Einmal-Codes", () => {
  it("akzeptiert den Code genau einmal", async () => {
    const u = await user();
    const code = await issueCode(u.id, "two_factor", { channel: "email" });
    expect(code).toMatch(/^\d{6}$/);
    expect(await consumeCode(u.id, "two_factor", code)).not.toBeNull();
    expect(await consumeCode(u.id, "two_factor", code)).toBeNull();
  });
  it("sperrt nach 5 Fehlversuchen, auch für den richtigen Code", async () => {
    const u = await user();
    const code = await issueCode(u.id, "two_factor");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await consumeCode(u.id, "two_factor", wrong)).toBeNull();
    expect(await consumeCode(u.id, "two_factor", code)).toBeNull();
  });
  it("ein neuer Code macht den alten ungültig; Zwecke sind getrennt", async () => {
    const u = await user();
    const first = await issueCode(u.id, "two_factor");
    const second = await issueCode(u.id, "two_factor");
    if (first !== second) expect(await consumeCode(u.id, "two_factor", first)).toBeNull();
    expect(await consumeCode(u.id, "verify_phone", second)).toBeNull();
    expect(await consumeCode(u.id, "two_factor", second)).not.toBeNull();
  });
  it("abgelaufene Codes gelten nicht", async () => {
    const u = await user();
    const code = await issueCode(u.id, "two_factor");
    await db.update(schema.authCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeCode(u.id, "two_factor", code)).toBeNull();
  });
  it("Reset-Links sind einmalig und manipulationssicher", async () => {
    const u = await user();
    const token = await issueResetToken(u.id);
    expect(await resolveResetToken(token.replace(/.$/, (c) => (c === "a" ? "b" : "a")), false)).toBeNull();
    expect((await resolveResetToken(token, false))?.userId).toBe(u.id);
    expect(await resolveResetToken(token, true)).not.toBeNull();
    expect(await resolveResetToken(token, true)).toBeNull();
  });
});

describe("Telefonnummern", () => {
  it("normalisiert deutsche Nummern", () => {
    expect(normalizePhone("0151 234 56789")).toBe("+4915123456789");
    expect(normalizePhone("0049 (151) 234-56789")).toBe("+4915123456789");
    expect(normalizePhone("+43 664 1234567")).toBe("+436641234567");
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("Admin-Zugang", () => {
  it("legt den Admin an und setzt das Startpasswort nur einmal", async () => {
    (env as { ADMIN_INITIAL_PASSWORD?: string }).ADMIN_INITIAL_PASSWORD = "Start-Passwort-2026";
    await ensureAdmin();
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, env.ADMIN_EMAIL));
    expect(admin!.role).toBe("admin");
    expect(admin!.mustChangePassword).toBe(true);
    expect(await verifyPassword("Start-Passwort-2026", admin!.passwordHash)).toBe(true);

    // Nach eigenem Passwort darf ein erneuter Start nichts überschreiben
    await db.update(schema.users).set({ passwordHash: await hashPassword("mein eigenes Passwort"), mustChangePassword: false }).where(eq(schema.users.id, admin!.id));
    await ensureAdmin();
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, admin!.id));
    expect(await verifyPassword("mein eigenes Passwort", after!.passwordHash)).toBe(true);
    expect(after!.mustChangePassword).toBe(false);
    (env as { ADMIN_INITIAL_PASSWORD?: string }).ADMIN_INITIAL_PASSWORD = undefined;
  });
  it("macht ein bestehendes Google-Konto mit der Admin-Adresse zum Admin", async () => {
    await user(env.ADMIN_EMAIL);
    await ensureAdmin();
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, env.ADMIN_EMAIL));
    expect(admin!.role).toBe("admin");
    expect(admin!.passwordHash).toBeNull();
  });
});
