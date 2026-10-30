"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  changePasswordAction,
  forgotPasswordAction,
  loginAction,
  resendLoginCodeAction,
  resetPasswordAction,
  verifyLoginCodeAction,
  type FormState,
} from "@/app/login/actions";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <div className="notice error">{state.error}</div>;
  if (state?.message) return <div className="notice">{state.message}</div>;
  return null;
}

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Feedback state={state} />
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="email">E-Mail-Adresse</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password" style={{ display: "flex", justifyContent: "space-between" }}>
          Passwort <Link href="/passwort-vergessen" className="link-more">Passwort vergessen?</Link>
        </label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <button className="btn btn-primary" style={{ height: 48 }} disabled={pending}>
        {pending ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}

export function CodeForm({ hint }: { hint: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyLoginCodeAction, null);
  const [resendState, resend, resending] = useActionState<FormState, FormData>(async () => resendLoginCodeAction(), null);
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>{hint}</p>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Feedback state={state ?? resendState} />
        <input
          name="code"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123456"
          required
          autoFocus
          style={{ fontSize: 26, letterSpacing: "0.4em", textAlign: "center", height: 60 }}
        />
        <button className="btn btn-primary" style={{ height: 48 }} disabled={pending}>
          {pending ? "Prüfe …" : "Bestätigen"}
        </button>
      </form>
      <form action={resend}>
        <button className="btn btn-ghost btn-sm" disabled={resending}>Neuen Code senden</button>
      </form>
    </>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Feedback state={state} />
      {!state?.message && (
        <>
          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input id="email" name="email" type="email" className="input" required autoFocus />
          </div>
          <button className="btn btn-primary" style={{ height: 48 }} disabled={pending}>
            Link zum Zurücksetzen senden
          </button>
        </>
      )}
      <Link href="/login" className="link-more">Zurück zur Anmeldung</Link>
    </form>
  );
}

function NewPasswordFields() {
  return (
    <>
      <div className="field">
        <label htmlFor="password">Neues Passwort</label>
        <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required />
        <small className="muted">Mindestens 10 Zeichen. Ein Satz oder mehrere Wörter sind sicherer als kurze Sonderzeichen-Passwörter.</small>
      </div>
      <div className="field">
        <label htmlFor="confirm">Neues Passwort wiederholen</label>
        <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" minLength={10} required />
      </div>
    </>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Feedback state={state} />
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields />
      <button className="btn btn-primary" style={{ height: 48 }} disabled={pending}>Passwort speichern</button>
    </form>
  );
}

export function ChangePasswordForm({ requireCurrent, submitLabel = "Passwort ändern" }: { requireCurrent: boolean; submitLabel?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 460 }}>
      <Feedback state={state} />
      {requireCurrent && (
        <div className="field">
          <label htmlFor="current">Aktuelles Passwort</label>
          <input id="current" name="current" type="password" className="input" autoComplete="current-password" required />
        </div>
      )}
      <NewPasswordFields />
      <button className="btn btn-primary" disabled={pending}>{submitLabel}</button>
    </form>
  );
}
