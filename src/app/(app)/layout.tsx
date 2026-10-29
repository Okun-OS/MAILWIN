import { and, count, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [[approvals], [notes]] = await Promise.all([
    db.select({ n: count() }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.userId, user.id), eq(schema.approvalRequests.status, "pending"))),
    db.select({ n: count() }).from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
  ]);
  return (
    <div className="shell">
      <Sidebar user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl }} counts={{ approvals: approvals?.n ?? 0 }} />
      <div className="main">
        <Topbar user={user} unreadNotifications={notes?.n ?? 0} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
