import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
import { ensureAdmin } from "../auth/bootstrap";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrationen angewendet.");
console.log(await ensureAdmin());
await pool.end();
