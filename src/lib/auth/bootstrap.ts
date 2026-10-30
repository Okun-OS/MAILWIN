import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { hashPassword } from "./password";

/**
 * Stellt den Admin-Zugang sicher (läuft beim Start nach den Migrationen).
 * Das Startpasswort wird nur gesetzt, solange der Admin noch keins hat – danach ist die Variable wirkungslos.
 */
export async function ensureAdmin(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!existing) {
    await db.insert(schema.users).values({
      email,
      name: "Admin",
      role: "admin",
      ...(env.ADMIN_INITIAL_PASSWORD ? { passwordHash: await hashPassword(env.ADMIN_INITIAL_PASSWORD), mustChangePassword: true } : {}),
    });
    return `Admin ${email} angelegt.`;
  }
  const patch: Partial<typeof schema.users.$inferInsert> = {};
  if (existing.role !== "admin") patch.role = "admin";
  if (!existing.passwordHash && env.ADMIN_INITIAL_PASSWORD) {
    patch.passwordHash = await hashPassword(env.ADMIN_INITIAL_PASSWORD);
    patch.mustChangePassword = true;
  }
  if (Object.keys(patch).length) {
    await db.update(schema.users).set({ ...patch, updatedAt: new Date() }).where(eq(schema.users.id, existing.id));
    return `Admin ${email} aktualisiert.`;
  }
  return `Admin ${email} vorhanden.`;
}
