import { issueCode } from "./codes";
import { notify, systemMail } from "../notify";
import type { SessionUser } from "./session";

/** Sendet den Anmeldecode über die vom Nutzer gewählte Methode. */
export async function sendLoginCode(user: SessionUser): Promise<void> {
  if (user.twoFactorMethod === "sms" && user.phone) {
    const code = await issueCode(user.id, "two_factor", { channel: "sms", target: user.phone });
    await notify.sms(user.phone, `${code} ist dein Anmeldecode für OKUN Mailwin. Gültig 10 Minuten.`);
    return;
  }
  const code = await issueCode(user.id, "two_factor", { channel: "email", target: user.email });
  const mail = systemMail("Dein Anmeldecode", [`Dein Code für die Anmeldung bei OKUN Mailwin lautet: ${code}`, "Er ist 10 Minuten gültig."]);
  await notify.email(user.email, `${code} – dein Anmeldecode für Mailwin`, mail.text, mail.html);
}

/** „+49 151 2345678“ → „+491512345678“. Deutsche Nummern ohne Vorwahl werden ergänzt. */
export function normalizePhone(input: string): string | null {
  let p = input.replace(/[\s()/-]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (p.startsWith("0")) p = `+49${p.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

export function maskTarget(target: string): string {
  if (target.includes("@")) {
    const [local, domain] = target.split("@");
    return `${local!.slice(0, 2)}…@${domain}`;
  }
  return `${target.slice(0, 4)} … ${target.slice(-3)}`;
}
