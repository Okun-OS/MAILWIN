/**
 * Hintergrund-Worker (Spezifikation 15.4): läuft unabhängig vom Browser.
 * Start: npm run worker
 */
import { claimNext, complete, fail, releaseStale } from "../lib/jobs/queue";
import { handlers, PermanentJobError, scheduleSyncs } from "../lib/jobs/handlers";
import { pool } from "../lib/db";

const SYNC_INTERVAL_MS = 2 * 60_000;
const IDLE_MS = 2_000;
let running = true;

async function tick(): Promise<boolean> {
  const job = await claimNext();
  if (!job) return false;
  const handler = handlers[job.kind];
  if (!handler) {
    await fail(job, `Kein Handler für ${job.kind}`, { permanent: true });
    return true;
  }
  try {
    await handler(job);
    await complete(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ${job.kind} fehlgeschlagen:`, message);
    await fail(job, message, { permanent: err instanceof PermanentJobError });
  }
  return true;
}

async function main() {
  console.log("[worker] gestartet");
  let lastSchedule = 0;
  while (running) {
    try {
      if (Date.now() - lastSchedule > SYNC_INTERVAL_MS) {
        await releaseStale();
        await scheduleSyncs();
        lastSchedule = Date.now();
      }
      const worked = await tick();
      if (!worked) await new Promise((r) => setTimeout(r, IDLE_MS));
    } catch (err) {
      console.error("[worker] Fehler in der Schleife:", err);
      await new Promise((r) => setTimeout(r, IDLE_MS * 5));
    }
  }
  await pool.end();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (running = false));
void main();
