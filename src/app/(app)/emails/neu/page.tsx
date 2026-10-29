import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { listAccounts } from "@/lib/mail/accounts";
import { signatureFor } from "@/lib/mail/actions";
import { formatAddress, replySubject } from "@/lib/mail/mime";
import { ComposeForm, type ComposeDefaults } from "@/components/ComposeForm";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Neue E-Mail" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ antwort?: string; weiterleiten?: string; an?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const accounts = (await listAccounts(user.id)).filter((a) => a.status === "active");
  if (!accounts.length) {
    return (
      <div className="card empty">
        <b>Kein aktives E-Mail-Konto</b>
        Verbinde zuerst ein Konto, um E-Mails zu senden.
        <Link className="btn btn-primary btn-sm" href="/einstellungen">
          Zu den Einstellungen
        </Link>
      </div>
    );
  }

  let defaults: ComposeDefaults = { accountId: accounts[0]!.id, to: sp.an ?? "", cc: "", subject: "", body: "" };
  let title = "Neue E-Mail";
  const refId = sp.antwort ?? sp.weiterleiten;
  if (refId && /^[0-9a-f-]{36}$/.test(refId)) {
    const [ref] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, refId), eq(schema.emails.userId, user.id)));
    if (ref) {
      if (sp.antwort) {
        title = "Antworten";
        const recipient = ref.isOutgoing ? ref.to : ref.from ? [ref.from] : [];
        defaults = {
          accountId: ref.accountId,
          to: recipient.map(formatAddress).join(", "),
          cc: "",
          subject: replySubject(ref.subject ?? ""),
          body: "",
          replyToEmailId: ref.id,
          quoted: `Antwort auf die Nachricht von ${ref.from?.name ?? ref.from?.email ?? "unbekannt"} vom ${ref.receivedAt.toLocaleDateString("de-DE")} – sie bleibt im selben Verlauf.`,
        };
      } else {
        title = "Weiterleiten";
        defaults = {
          accountId: ref.accountId,
          to: "",
          cc: "",
          subject: /^(fwd?|wg)\s*:/i.test(ref.subject ?? "") ? ref.subject ?? "" : `WG: ${ref.subject ?? ""}`,
          body: "",
          forwardEmailId: ref.id,
          quoted: "Die ursprüngliche Nachricht und ihre Anhänge werden unter deinem Text angefügt.",
        };
      }
    }
  }
  const signature = await signatureFor(user.id, defaults.accountId);

  return (
    <>
      <div className="page-title">
        <div>
          <Link href="/emails" className="link-more">
            <Icon name="chevronLeft" size={14} /> Posteingang
          </Link>
          <h1 style={{ marginTop: 6 }}>{title}</h1>
          <p>Lieber schreiben lassen? Sag Marvin, worum es geht – er bereitet den Entwurf vor.</p>
        </div>
      </div>
      <ComposeForm accounts={accounts.map((a) => ({ id: a.id, email: a.emailAddress }))} defaults={defaults} signature={signature?.text ?? null} />
    </>
  );
}
