import { and, count, eq, gte, isNull, lte, or } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const now = new Date();
  const [[approvals], [notes], announcements] = await Promise.all([
    db.select({ n: count() }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.userId, user.id), eq(schema.approvalRequests.status, "pending"))),
    db.select({ n: count() }).from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
    db
      .select()
      .from(schema.announcements)
      .where(and(eq(schema.announcements.active, true), lte(schema.announcements.startsAt, now), or(isNull(schema.announcements.endsAt), gte(schema.announcements.endsAt, now)))),
  ]);
  return (
    <div className="shell">
      <Sidebar user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: user.role === "admin" }} counts={{ approvals: approvals?.n ?? 0 }} />
      <div className="main">
        <Topbar user={user} unreadNotifications={notes?.n ?? 0} />
        <main className="content">
          {announcements.map((a) => (
            <div key={a.id} className={`notice${a.level === "warning" ? " warn" : ""}`} style={{ marginBottom: 14 }} role="status">
              <span>
                <b>{a.title}</b>
                {a.body ? ` – ${a.body}` : ""}
              </span>
            </div>
          ))}
          {children}
        </main>
      </div>
    </div>
  );
}
