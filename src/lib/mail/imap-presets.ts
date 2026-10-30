/** Server-Einstellungen gängiger Anbieter. App-Passwort = gesondertes Passwort für externe Programme. */
export interface ImapSettings {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  /** Gesendete Nachrichten selbst im Ordner „Gesendet“ ablegen (die meisten Anbieter tun das per SMTP nicht) */
  appendSent: boolean;
}

export interface Preset {
  key: string;
  label: string;
  domains: string[];
  settings: Omit<ImapSettings, "username">;
  hint: string;
}

export const PRESETS: Preset[] = [
  {
    key: "gmx",
    label: "GMX",
    domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"],
    settings: { imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecure: false, appendSent: true },
    hint: "Im GMX-Postfach unter Einstellungen → POP3/IMAP-Abruf den Zugriff per IMAP erlauben.",
  },
  {
    key: "webde",
    label: "WEB.DE",
    domains: ["web.de"],
    settings: { imapHost: "imap.web.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false, appendSent: true },
    hint: "Im WEB.DE-Postfach unter Einstellungen → POP3/IMAP-Abruf den Zugriff per IMAP erlauben.",
  },
  {
    key: "tonline",
    label: "T-Online",
    domains: ["t-online.de", "magenta.de"],
    settings: { imapHost: "secureimap.t-online.de", imapPort: 993, imapSecure: true, smtpHost: "securesmtp.t-online.de", smtpPort: 465, smtpSecure: true, appendSent: true },
    hint: "Verwende das E-Mail-Passwort aus dem Telekom-Kundencenter (nicht das Login-Passwort).",
  },
  {
    key: "icloud",
    label: "iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    settings: { imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false, appendSent: false },
    hint: "Erstelle unter appleid.apple.com → Anmeldung und Sicherheit ein app-spezifisches Passwort. Benutzername ist die iCloud-Adresse ohne @icloud.com.",
  },
  {
    key: "yahoo",
    label: "Yahoo Mail",
    domains: ["yahoo.com", "yahoo.de", "ymail.com"],
    settings: { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true, appendSent: false },
    hint: "Erstelle in den Yahoo-Kontoeinstellungen unter „Kontosicherheit“ ein App-Passwort.",
  },
  {
    key: "ionos",
    label: "IONOS (1&1)",
    domains: ["ionos.de", "online.de"],
    settings: { imapHost: "imap.ionos.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.ionos.de", smtpPort: 465, smtpSecure: true, appendSent: true },
    hint: "Auch für eigene Domains bei IONOS. Benutzername ist die vollständige E-Mail-Adresse.",
  },
  {
    key: "strato",
    label: "STRATO",
    domains: ["strato.de"],
    settings: { imapHost: "imap.strato.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.strato.de", smtpPort: 465, smtpSecure: true, appendSent: true },
    hint: "Auch für eigene Domains bei STRATO. Benutzername ist die vollständige E-Mail-Adresse.",
  },
];

export function presetFor(email: string): Preset | undefined {
  const domain = email.split("@")[1]?.toLowerCase();
  return PRESETS.find((p) => p.domains.includes(domain ?? ""));
}
