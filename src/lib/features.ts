import type { SessionUser } from "./auth/session";

/** Funktionen, die der Admin pro Kunde schalten kann. Standard: an. */
export const FEATURES = {
  marvin: { label: "Marvin (KI-Assistent)", description: "Chat, Entwürfe und Projektplanung mit Marvin" },
  web_search: { label: "Websuche für Marvin", description: "Marvin darf im Internet recherchieren" },
  additional_mailboxes: { label: "Weitere Postfächer", description: "Mehr als ein E-Mail-Konto verbinden" },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function hasFeature(user: Pick<SessionUser, "features">, key: FeatureKey): boolean {
  return user.features?.[key] !== false;
}
