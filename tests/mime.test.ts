import { describe, expect, it } from "vitest";
import { buildMimeMessage, decodeHeaderWords, encodeHeaderWord, parseAddressList, replySubject } from "@/lib/mail/mime";

describe("Adressen", () => {
  it("zerlegt Listen mit Kommas in Anführungszeichen", () => {
    expect(parseAddressList('"Müller, Thomas" <T.Mueller@MP.de>, anna@weber.de')).toEqual([
      { name: "Müller, Thomas", email: "t.mueller@mp.de" },
      { email: "anna@weber.de" },
    ]);
  });
  it("ignoriert Ungültiges", () => {
    expect(parseAddressList("kein-empfaenger, ")).toEqual([]);
  });
});

describe("Header-Kodierung", () => {
  it("kodiert Umlaute als RFC-2047 und dekodiert sie wieder", () => {
    const encoded = encodeHeaderWord("Rückfrage zur Größe – äöü ß");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeHeaderWords(encoded.replace(/\r\n /g, " "))).toBe("Rückfrage zur Größe – äöü ß");
  });
  it("dekodiert Q-Kodierung in ISO-8859-1", () => {
    expect(decodeHeaderWords("=?ISO-8859-1?Q?Gr=FC=DFe_aus_K=F6ln?=")).toBe("Grüße aus Köln");
  });
});

describe("buildMimeMessage", () => {
  const base = {
    from: { name: "Sarah Neumann", email: "sarah@okun.de" },
    to: [{ name: "Lena Schröder", email: "lena@nordlicht.de" }],
    subject: "Angebot für Q4",
    text: "Hallo Lena,\nanbei das Angebot.",
  };

  it("setzt Antwort-Header für korrektes Threading", () => {
    const raw = buildMimeMessage({ ...base, inReplyTo: "<abc@x>", references: ["<root@x>"] });
    expect(raw).toContain("In-Reply-To: <abc@x>");
    expect(raw).toContain("References: <root@x> <abc@x>");
    expect(raw).toContain("\r\n");
  });

  it("enthält Text- und HTML-Teil sowie Anhänge", () => {
    const raw = buildMimeMessage({ ...base, html: "<p>Hallo</p>", attachments: [{ filename: "Angebot.pdf", mimeType: "application/pdf", content: Buffer.from("PDF") }] });
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain('filename="Angebot.pdf"');
    expect(raw).toContain(Buffer.from("PDF").toString("base64"));
  });

  it("kodiert Namen mit Umlauten im From/To-Header", () => {
    const raw = buildMimeMessage(base);
    expect(raw).toMatch(/To: =\?UTF-8\?B\?[^?]+\?= <lena@nordlicht.de>/);
  });
});

describe("replySubject", () => {
  it("setzt Re: nur einmal", () => {
    expect(replySubject("Angebot")).toBe("Re: Angebot");
    expect(replySubject("AW: Angebot")).toBe("AW: Angebot");
    expect(replySubject("re: Angebot")).toBe("re: Angebot");
  });
});
