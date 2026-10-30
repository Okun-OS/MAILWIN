import Image from "next/image";
import { Brand } from "../Brand";
import { MarvinPointing } from "../Marvin";

/** Gemeinsamer Rahmen der Anmeldeseiten: Bürohintergrund mit Marvin links, Formular rechts. */
export function AuthShell({ title, subtitle, children }: { title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="visual">
        <Image src="/brand/buero-hintergrund.webp" alt="" fill priority className="bg" sizes="55vw" />
        <div className="robot">
          <MarvinPointing width={520} priority />
        </div>
      </div>
      <div className="form">
        <Brand />
        <h1 style={{ fontSize: 30, letterSpacing: "-0.02em" }}>{title}</h1>
        {subtitle && <p className="muted" style={{ fontSize: 15, margin: 0 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
