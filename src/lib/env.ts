import { z } from "zod";

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://mailwin:mailwin@localhost:5432/mailwin"),
  ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Admin-Zugang (wird beim Start angelegt, Startpasswort nur, solange noch keins gesetzt ist)
  ADMIN_EMAIL: z.string().email().default("kontakt@okun-systems.com"),
  ADMIN_INITIAL_PASSWORD: z.string().min(10).optional(),
  // Neue Nutzer per Google-Anmeldung zulassen? Standard: nein – Konten legt der Admin (später Stripe) an
  ALLOW_GOOGLE_SIGNUP: z.enum(["true", "false"]).default("false"),
  // System-E-Mails (Codes, Passwort-Links) über Resend
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // SMS-Codes über Twilio; TWILIO_FROM = Absendernummer (+49…) oder Messaging-Service-SID (MG…)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
});

// Leere Werte (z. B. in Hosting-Oberflächen angelegt, aber nicht befüllt) gelten als nicht gesetzt
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));

/** Liefert eine Pflicht-Variable oder wirft eine verständliche Fehlermeldung. */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Konfiguration fehlt: ${key} ist nicht gesetzt (siehe .env.example).`);
  }
  return value as NonNullable<(typeof env)[K]>;
}

export const integrations = {
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  marvin: Boolean(env.ANTHROPIC_API_KEY),
};

/**
 * Absolute URL für Weiterleitungen. Nicht aus req.url ableiten: Hinter einem Proxy
 * (Railway) ist das die interne Adresse, z. B. http://localhost:8080.
 */
export function appUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}
