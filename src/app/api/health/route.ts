import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Health-Check für das Hosting (Railway): App läuft und Datenbank antwortet. */
export async function GET() {
  try {
    await pool.query("select 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "database" }, { status: 503 });
  }
}
