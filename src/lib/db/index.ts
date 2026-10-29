import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

const globalForDb = globalThis as unknown as { pool?: Pool };

// Im Dev-Server überlebt der Pool Hot-Reloads
const pool = globalForDb.pool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema, pool };
