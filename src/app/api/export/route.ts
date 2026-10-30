import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { exportUserData } from "@/lib/admin";
import { audit } from "@/lib/audit";

/** Eigene Daten herunterladen (DSGVO Art. 15/20). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Nicht angemeldet", { status: 401 });
  const data = await exportUserData(user.id);
  await audit({ userId: user.id, actor: "user", action: "export_data", status: "success" });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="mailwin-meine-daten.json"` },
  });
}
