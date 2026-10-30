import Link from "next/link";
import { channels } from "@/lib/notify";
import { AdminForm } from "@/components/admin/AdminForms";
import { Icon } from "@/components/Icon";
import { createUserAction } from "../../actions";

export const metadata = { title: "Kunde anlegen · Admin" };

export default function NewCustomerPage() {
  return (
    <section className="card card-pad" style={{ maxWidth: 640 }}>
      <Link href="/admin/kunden" className="link-more"><Icon name="chevronLeft" size={14} /> Kunden</Link>
      <h2 style={{ margin: "10px 0 6px" }}>Kunde anlegen</h2>
      <p className="small muted">Mailwin erzeugt ein vorläufiges Passwort. Der Kunde legt bei der ersten Anmeldung ein eigenes fest.</p>
      <AdminForm action={createUserAction} submit="Konto anlegen">
        <div className="field"><label>E-Mail-Adresse</label><input className="input" name="email" type="email" required /></div>
        <div className="field"><label>Name</label><input className="input" name="name" /></div>
        <div className="split" style={{ gap: 12 }}>
          <div className="field">
            <label>Tarif</label>
            <select className="select" name="plan" defaultValue="trial">
              <option value="trial">Testphase</option><option value="basic">Basic</option><option value="pro">Pro</option><option value="business">Business</option><option value="internal">Intern</option>
            </select>
          </div>
          <div className="field">
            <label>Rolle</label>
            <select className="select" name="role" defaultValue="user"><option value="user">Kunde</option><option value="admin">Admin</option></select>
          </div>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 14px", opacity: channels.email ? 1 : 0.5 }}>
          <input type="checkbox" name="sendInvite" disabled={!channels.email} defaultChecked={channels.email} />
          Zugangsdaten per E-Mail senden {!channels.email && <span className="badge">Resend nicht eingerichtet</span>}
        </label>
      </AdminForm>
    </section>
  );
}
