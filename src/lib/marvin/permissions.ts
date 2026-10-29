import type { Account } from "../mail/accounts";

/**
 * Freigabemodell (Spezifikation 14):
 *   read        Stufe 1 – lesen & analysieren
 *   organize    Stufe 2 – Labels, archivieren, als gelesen markieren
 *   communicate Stufe 3 – senden/weiterleiten, immer über eine Freigabe
 *   critical    Stufe 4 – Papierkorb/Löschen, immer mit gesonderter Bestätigung
 */
export type Capability = "read" | "organize" | "communicate" | "critical";

const RANK: Record<Account["permissionLevel"], number> = { read: 1, organize: 2, communicate: 3 };
const REQUIRED: Record<Capability, number> = { read: 1, organize: 2, communicate: 3, critical: 2 };

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/** Darf eine Fähigkeit auf diesem Konto überhaupt angestoßen werden? */
export function assertCapability(account: Account, capability: Capability): void {
  if (account.status !== "active") {
    throw new PermissionDeniedError(`Das Konto ${account.emailAddress} ist nicht aktiv (${account.status}).`);
  }
  if (RANK[account.permissionLevel] < REQUIRED[capability]) {
    throw new PermissionDeniedError(
      `Für ${account.emailAddress} ist nur die Stufe „${LEVEL_LABEL[account.permissionLevel]}“ freigegeben. ` +
        `Diese Aktion benötigt „${CAPABILITY_LABEL[capability]}“. Der Nutzer kann das in den Einstellungen ändern.`,
    );
  }
}

/**
 * Muss die Aktion vor der Ausführung einzeln bestätigt werden?
 * Versand und kritische Aktionen: immer. Organisieren: nein (Stufe 2 ist dafür freigegeben).
 */
export function needsApproval(capability: Capability): boolean {
  return capability === "communicate" || capability === "critical";
}

export const LEVEL_LABEL: Record<Account["permissionLevel"], string> = {
  read: "Lesen & Analysieren",
  organize: "Organisieren",
  communicate: "Kommunizieren (mit Freigabe)",
};

const CAPABILITY_LABEL: Record<Capability, string> = {
  read: "Lesen",
  organize: "Organisieren",
  communicate: "Kommunizieren",
  critical: "Kritische Aktion",
};
