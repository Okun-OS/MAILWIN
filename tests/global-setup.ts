import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://mailwin:mailwin@localhost:5432/mailwin_test" });
  await pool.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
