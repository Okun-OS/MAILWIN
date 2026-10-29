import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getOwnedAccount, providerFor } from "@/lib/mail/accounts";

/** Lädt einen Anhang direkt vom Anbieter – immer als Download, nie inline (sichere Behandlung). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  const [row] = await db
    .select({ att: schema.attachments, email: schema.emails })
    .from(schema.attachments)
    .innerJoin(schema.emails, eq(schema.emails.id, schema.attachments.emailId))
    .where(and(eq(schema.attachments.id, id), eq(schema.emails.userId, user.id)));
  if (!row) return new NextResponse("Nicht gefunden", { status: 404 });
  const account = await getOwnedAccount(user.id, row.email.accountId);
  const data = await providerFor(account).getAttachment(row.email.providerMessageId, row.att.providerAttachmentId);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.att.filename)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
