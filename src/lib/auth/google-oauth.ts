import { google } from "googleapis";
import { env, requireEnv } from "../env";

/**
 * Minimal nötige Berechtigungen (Spezifikation 2 & 14):
 * - gmail.modify: lesen, Labels setzen, archivieren, in den Papierkorb – KEIN dauerhaftes Löschen
 * - gmail.send: Versand
 * - calendar.readonly: Termine für Dashboard und Wochenansicht
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    `${env.APP_URL}/api/auth/google/callback`,
  );
}
