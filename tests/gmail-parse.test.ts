import { describe, expect, it } from "vitest";
import { parseGmailMessage } from "@/lib/mail/gmail";

const b64 = (s: string, enc: BufferEncoding = "utf8") => Buffer.from(s, enc).toString("base64url");

describe("parseGmailMessage", () => {
  it("liest verschachtelte multipart-Nachrichten mit Anhang", () => {
    const m = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
      snippet: "Hallo &amp; willkommen",
      internalDate: "1767225600000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: '"Müller, Thomas" <t.mueller@mp.de>' },
          { name: "To", value: "sarah@okun.de" },
          { name: "Subject", value: "Rückfrage zur Rechnung" },
          { name: "Message-ID", value: "<abc@mp.de>" },
          { name: "References", value: "<r1@x> <r2@x>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data: b64("Guten Morgen, äöü") } },
              { mimeType: "text/html", body: { data: b64("<p>Guten Morgen</p>") } },
            ],
          },
          { mimeType: "application/pdf", filename: "RE-1842.pdf", body: { attachmentId: "att1", size: 2048 } },
        ],
      },
    });
    expect(m.from).toEqual({ name: "Müller, Thomas", email: "t.mueller@mp.de" });
    expect(m.subject).toBe("Rückfrage zur Rechnung");
    expect(m.bodyText).toBe("Guten Morgen, äöü");
    expect(m.bodyHtml).toBe("<p>Guten Morgen</p>");
    expect(m.attachments).toEqual([{ providerAttachmentId: "att1", filename: "RE-1842.pdf", mimeType: "application/pdf", sizeBytes: 2048 }]);
    expect(m.isRead).toBe(false);
    expect(m.references).toEqual(["<r1@x>", "<r2@x>"]);
    expect(m.snippet).toBe("Hallo & willkommen");
    expect(m.receivedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("dekodiert Latin-1 und erzeugt Text aus reinem HTML", () => {
    const m = parseGmailMessage({
      id: "m2",
      threadId: "t2",
      labelIds: ["SENT"],
      payload: {
        mimeType: "text/html",
        headers: [{ name: "Content-Type", value: 'text/html; charset="iso-8859-1"' }],
        body: { data: b64("<p>Grüße<br>aus Köln</p>", "latin1") },
      },
    });
    expect(m.bodyHtml).toBe("<p>Grüße<br>aus Köln</p>");
    expect(m.bodyText).toBe("Grüße\naus Köln");
    expect(m.isOutgoing).toBe(true);
  });
});
