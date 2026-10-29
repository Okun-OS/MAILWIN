import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { buildGreeting } from "@/lib/dashboard/greeting";
import { startOfDayIn, startOfWeekIn } from "@/lib/time";
import { toApiMessages } from "@/lib/marvin/history";

describe("Verschlüsselung", () => {
  it("verschlüsselt mit Zufalls-IV und entschlüsselt korrekt", () => {
    const a = encrypt("ya29.geheim");
    expect(a).not.toContain("geheim");
    expect(a).not.toBe(encrypt("ya29.geheim"));
    expect(decrypt(a)).toBe("ya29.geheim");
  });
  it("erkennt Manipulation", () => {
    const [v, iv, tag, ct] = encrypt("token").split(".");
    const tampered = [v, iv, tag, Buffer.from("x" + Buffer.from(ct!, "base64url").toString("latin1"), "latin1").toString("base64url")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe("Marvins Begrüßung", () => {
  const zero = { needsReply: 0, awaitingReplyOver3Days: 0, eventsRemainingToday: 0, tasksDueToday: 0 };
  it("nutzt Tageszeit und Vornamen", () => {
    expect(buildGreeting({ name: "Sarah Neumann", hour: 8, overview: zero, pendingApprovals: 0 }).title).toBe("Guten Morgen, Sarah!");
    expect(buildGreeting({ name: null, hour: 20, overview: zero, pendingApprovals: 0 }).title).toBe("Guten Abend!");
  });
  it("fasst nur echte Zahlen zusammen", () => {
    const g = buildGreeting({ name: "Sarah", hour: 9, overview: { ...zero, needsReply: 3, eventsRemainingToday: 1 }, pendingApprovals: 2 });
    expect(g.text).toBe("Hier ist dein Überblick: 3 E-Mails warten auf deine Antwort, 1 Termin steht heute noch an und 2 Entwürfe liegen zur Freigabe bereit.");
  });
  it("hat einen ruhigen Leerzustand", () => {
    expect(buildGreeting({ name: "Sarah", hour: 9, overview: zero, pendingApprovals: 0 }).text).toContain("nichts Dringendes");
  });
});

describe("Zeitzonen", () => {
  it("berechnet Mitternacht in Berlin – auch über die Zeitumstellung", () => {
    expect(startOfDayIn(new Date("2026-10-29T10:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-28T23:00:00.000Z");
    expect(startOfDayIn(new Date("2026-07-01T10:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDayIn(new Date("2026-10-25T12:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
  it("findet den Montag der Woche", () => {
    expect(startOfWeekIn(new Date("2026-10-29T10:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("Verlauf für die API", () => {
  it("führt aufeinanderfolgende Nutzer-Nachrichten zusammen, Tool-Ergebnisse zuerst", () => {
    const out = toApiMessages([
      { role: "user", content: [{ type: "text", text: "Hallo" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "list_tasks", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "[]" }] },
      { role: "user", content: [{ type: "text", text: "[Systemhinweis von Mailwin] Freigabe erteilt" }] },
    ]);
    expect(out).toHaveLength(3);
    expect((out[2]!.content as { type: string }[]).map((b) => b.type)).toEqual(["tool_result", "text"]);
  });
});
