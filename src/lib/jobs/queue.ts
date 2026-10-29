import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";

export type Job = typeof schema.jobs.$inferSelect;

/** Reiht einen Job ein. Mit `dedupeKey` gibt es pro Schlüssel höchstens einen offenen Job. */
export async function enqueue(kind: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAt?: Date } = {}) {
  const rows = await db
    .insert(schema.jobs)
    .values({ kind, payload, dedupeKey: opts.dedupeKey ?? null, runAt: opts.runAt ?? new Date() })
    .onConflictDoNothing()
    .returning({ id: schema.jobs.id });
  return rows[0]?.id ?? null;
}

/** Holt den nächsten fälligen Job; SKIP LOCKED erlaubt mehrere Worker parallel. */
export async function claimNext(): Promise<Job | null> {
  const result = await db.execute<Job>(sql`
    update ${schema.jobs} set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from ${schema.jobs}
      where status = 'queued' and run_at <= now()
      order by run_at
      for update skip locked
      limit 1
    )
    returning id, kind, payload, dedupe_key as "dedupeKey", status, run_at as "runAt", attempts,
              max_attempts as "maxAttempts", locked_at as "lockedAt", last_error as "lastError", created_at as "createdAt"`);
  return (result.rows[0] as Job | undefined) ?? null;
}

export async function complete(id: string) {
  await db.update(schema.jobs).set({ status: "done", lockedAt: null }).where(eq(schema.jobs.id, id));
}

/** Exponentielles Backoff: 30 s, 1 min, 2 min, … bis maxAttempts, danach endgültig fehlgeschlagen. */
export async function fail(job: Job, error: string, opts: { permanent?: boolean } = {}) {
  const giveUp = opts.permanent || job.attempts >= job.maxAttempts;
  await db
    .update(schema.jobs)
    .set({
      status: giveUp ? "failed" : "queued",
      lastError: error.slice(0, 2000),
      lockedAt: null,
      runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)),
    })
    .where(eq(schema.jobs.id, job.id));
}

/** Jobs, deren Worker abgestürzt ist, wieder freigeben. */
export async function releaseStale(minutes = 10) {
  await db
    .update(schema.jobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(schema.jobs.status, "running"), sql`${schema.jobs.lockedAt} < now() - make_interval(mins => ${minutes})`));
}
