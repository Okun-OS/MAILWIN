import { db, schema } from "./db";

type AuditEntry = typeof schema.auditLogs.$inferInsert;

/** Jede ausgeführte (oder verweigerte) Aktion wird protokolliert – Spezifikation Abschnitt 14. */
export async function audit(entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values(entry);
}
