import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { exportUserData } from "@/lib/admin";
import { audit } from "@/lib/audit";

/** DSGVO-Datenexport eines Kunden – nur für Admins. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") return new NextResponse("Kein Zugriff", { status: 403 });
  const { userId } = await params;
  const data = await exportUserData(userId);
  await audit({ userId, actor: "admin", action: "admin_export_data", status: "success", details: { admin: admin.email } });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mailwin-export-${data.profil.email}.json"`,
    },
  });
}
