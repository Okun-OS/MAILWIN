import { appUrl } from "../env";
import { notify, systemMail } from "../notify";
import { issueResetToken } from "./codes";

/** Versendet einen Einmal-Link zum Zurücksetzen des Passworts (60 Minuten gültig). */
export async function sendResetMail(userId: string, email: string) {
  const token = await issueResetToken(userId);
  const mail = systemMail(
    "Passwort zurücksetzen",
    ["Du kannst dein Passwort für OKUN Mailwin über den folgenden Link neu festlegen.", "Der Link ist 60 Minuten gültig und kann nur einmal verwendet werden."],
    { label: "Neues Passwort festlegen", url: appUrl(`/passwort-zuruecksetzen?token=${encodeURIComponent(token)}`).toString() },
  );
  await notify.email(email, "Passwort für Mailwin zurücksetzen", mail.text, mail.html);
}
