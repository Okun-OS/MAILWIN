"use client";

import { useActionState, useState } from "react";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  logoutOtherSessionsAction,
  startTwoFactorAction,
  type SecurityState,
} from "@/app/(app)/einstellungen/security-actions";
import { ChangePasswordForm } from "./auth/forms";
import { ActionButton } from "./ConfirmButton";
import { Icon } from "./Icon";

interface Props {
  hasPassword: boolean;
  method: "none" | "email" | "sms";
  phoneMasked: string | null;
  emailAvailable: boolean;
  smsAvailable: boolean;
  sessionCount: number;
}

function Feedback({ state }: { state: SecurityState }) {
  if (state?.error) return <div className="notice error" style={{ marginBottom: 10 }}>{state.error}</div>;
  if (state?.message) return <div className="notice" style={{ marginBottom: 10 }}>{state.message}</div>;
  return null;
}

export function SecuritySection(p: Props) {
  const [startState, start, starting] = useActionState<SecurityState, FormData>(startTwoFactorAction, null);
  const [confirmState, confirm, confirming] = useActionState<SecurityState, FormData>(confirmTwoFactorAction, null);
  const [disableState, disable, disabling] = useActionState<SecurityState, FormData>(disableTwoFactorAction, null);
  const [choice, setChoice] = useState<"email" | "sms">(p.emailAvailable ? "email" : "sms");
  const awaiting = confirmState?.awaitingCode ?? (confirmState?.message ? undefined : startState?.awaitingCode);
  const active = confirmState?.message && !confirmState.awaitingCode ? choice : disableState?.message ? "none" : p.method;

  return (
    <section className="card card-pad" id="sicherheit">
      <div className="card-head">
        <span className="head-icon"><Icon name="eye" /></span>
        <div>
          <h2>Sicherheit</h2>
          <p>Passwort, Zwei-Faktor-Anmeldung und angemeldete Geräte.</p>
        </div>
      </div>
      <div className="split" style={{ alignItems: "start" }}>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{p.hasPassword ? "Passwort ändern" : "Passwort festlegen"}</h3>
          {!p.hasPassword && <p className="small muted">Du meldest dich bisher nur mit Google an. Mit einem Passwort kannst du dich auch direkt anmelden.</p>}
          <ChangePasswordForm requireCurrent={p.hasPassword} />
        </div>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Zwei-Faktor-Anmeldung</h3>
          {active !== "none" ? (
            <>
              <div className="notice" style={{ marginBottom: 12 }}>
                Aktiv: Bei jeder Anmeldung bekommst du einen Code {active === "sms" ? `per SMS${p.phoneMasked ? ` an ${p.phoneMasked}` : ""}` : "per E-Mail"}.
              </div>
              <form action={disable} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Feedback state={disableState} />
                {p.hasPassword && <input className="input" type="password" name="password" placeholder="Passwort zur Bestätigung" required style={{ maxWidth: 260 }} />}
                <button className="btn btn-sm btn-danger" disabled={disabling}>Ausschalten</button>
              </form>
            </>
          ) : awaiting ? (
            <form action={confirm} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
              <Feedback state={confirmState ?? startState} />
              <input type="hidden" name="method" value={awaiting} />
              <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-stelliger Code" required />
              <button className="btn btn-primary btn-sm" disabled={confirming}>Bestätigen</button>
            </form>
          ) : (
            <form action={start} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
              <Feedback state={startState} />
              <p className="small muted" style={{ margin: 0 }}>Schützt dein Konto, auch wenn jemand dein Passwort kennt.</p>
              <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: p.emailAvailable ? 1 : 0.5 }}>
                <input type="radio" name="method" value="email" checked={choice === "email"} disabled={!p.emailAvailable} onChange={() => setChoice("email")} />
                Code per E-Mail {!p.emailAvailable && <span className="badge">noch nicht eingerichtet</span>}
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: p.smsAvailable ? 1 : 0.5 }}>
                <input type="radio" name="method" value="sms" checked={choice === "sms"} disabled={!p.smsAvailable} onChange={() => setChoice("sms")} />
                Code per SMS {!p.smsAvailable && <span className="badge">noch nicht eingerichtet</span>}
              </label>
              {choice === "sms" && <input className="input" name="phone" type="tel" placeholder="+49 151 23456789" required />}
              <button className="btn btn-primary btn-sm" disabled={starting || (!p.emailAvailable && !p.smsAvailable)}>Einrichten</button>
            </form>
          )}
          <h3 style={{ fontSize: 14, margin: "24px 0 8px" }}>Angemeldete Geräte</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Du bist auf {p.sessionCount} {p.sessionCount === 1 ? "Gerät" : "Geräten"} angemeldet.</p>
          {p.sessionCount > 1 && (
            <ActionButton action={logoutOtherSessionsAction} confirm="Alle anderen Geräte abmelden?">
              Andere Geräte abmelden
            </ActionButton>
          )}
        </div>
      </div>
    </section>
  );
}
