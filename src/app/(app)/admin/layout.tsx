import { requireAdmin } from "@/lib/auth/session";
import { AdminNav } from "./nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <div className="page-title" style={{ marginBottom: 12 }}>
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Verwaltung</h1>
        </div>
      </div>
      <AdminNav />
      {children}
    </>
  );
}
