import { env } from "./env";

/**
 * Versand von System-Nachrichten (Codes, Passwort-Links): E-Mail über Resend, SMS über Twilio.
 * Beide ohne SDK, direkt über die REST-Schnittstellen.
 */
export interface Notifier {
  email(to: string, subject: string, text: string, html?: string): Promise<void>;
  sms(to: string, text: string): Promise<void>;
}

export const channels = {
  get email() {
    return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
  },
  get sms() {
    return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
  },
};

const live: Notifier = {
  async email(to, subject, text, html) {
    if (!channels.email) throw new Error("E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM).");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) throw new Error(`E-Mail konnte nicht gesendet werden (Resend ${res.status}).`);
  },
  async sms(to, text) {
    if (!channels.sms) throw new Error("SMS-Versand ist nicht eingerichtet (TWILIO_*).");
    const sid = env.TWILIO_ACCOUNT_SID!;
    const from = env.TWILIO_FROM!;
    const body = new URLSearchParams({ To: to, Body: text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`SMS konnte nicht gesendet werden (Twilio ${res.status}).`);
  },
};

let current: Notifier = live;
/** Für Tests: Versand abfangen. */
export function setNotifier(n: Notifier | null) {
  current = n ?? live;
}
export const notify: Notifier = {
  email: (...a) => current.email(...a),
  sms: (...a) => current.sms(...a),
};

/** Einfache, markengerechte HTML-Hülle für System-E-Mails. */
export function systemMail(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Inter,Arial,sans-serif;color:#1b2433">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e8ecf2;border-radius:16px;padding:28px">
<div style="font-weight:800;font-size:18px;letter-spacing:.04em">OKUN <span style="color:#03bd7b;font-size:11px;letter-spacing:.4em">MAILWIN</span></div>
<h1 style="font-size:20px;margin:22px 0 12px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${esc(p)}</p>`).join("")}
${action ? `<p style="margin:22px 0"><a href="${action.url}" style="background:#03bd7b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">${esc(action.label)}</a></p>` : ""}
<p style="font-size:12px;color:#6b7385;margin-top:24px">Wenn du diese Nachricht nicht angefordert hast, kannst du sie ignorieren.</p>
</div></body></html>`;
  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join("\n");
  return { html, text };
}
