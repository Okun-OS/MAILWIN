import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";
import { and, eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { setProviderFactory } from "@/lib/mail/accounts";
import { syncAccount } from "@/lib/mail/sync";
import { sendEmail, threadAction } from "@/lib/mail/actions";
import { ImapProvider, deriveThreadId } from "@/lib/mail/imap";
import { ReauthRequiredError } from "@/lib/mail/types";
import type { ImapSettings } from "@/lib/mail/imap-presets";
import { resetDb } from "./helpers";

/**
 * Integrationstest gegen einen echten IMAP-Server (lokales Dovecot) und einen SMTP-Testserver.
 * Läuft nur, wenn IMAP_TEST_PORT erreichbar ist – siehe docs/STATUS.md.
 */
const IMAP_PORT = Number(process.env.IMAP_TEST_PORT ?? 14300);
const USER = process.env.IMAP_TEST_USER ?? "test@local.test";
const PASS = process.env.IMAP_TEST_PASS ?? "geheim123";
const SMTP_PORT = 25870;

const reachable = await new Promise<boolean>((resolve) => {
  const s = net.connect(IMAP_PORT, "127.0.0.1", () => (s.end(), resolve(true)));
  s.on("error", () => resolve(false));
});

const settings: ImapSettings = {
  imapHost: "127.0.0.1",
  imapPort: IMAP_PORT,
  imapSecure: false,
  smtpHost: "127.0.0.1",
  smtpPort: SMTP_PORT,
  smtpSecure: false,
  username: USER,
  appendSent: true,
};

const delivered: string[] = [];
let smtp: SMTPServer;

async function imap<T>(fn: (c: ImapFlow) => Promise<T>) {
  const c = new ImapFlow({ host: "127.0.0.1", port: IMAP_PORT, secure: false, auth: { user: USER, pass: PASS }, logger: false });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.logout();
  }
}

/** Testpostfach leeren – nur auf dem lokalen Testserver */
async function clearMailbox() {
  await imap(async (c) => {
    for (const path of ["INBOX", "Sent", "Archive", "Trash"]) {
      const lock = await c.getMailboxLock(path);
      try {
        if ((c.mailbox as { exists: number }).exists) await c.messageDelete("1:*");
      } finally {
        lock.release();
      }
    }
  });
}

const raw = (id: string, subject: string, extra = "") =>
  [`From: Lena Schröder <lena@nordlicht.de>`, `To: ${USER}`, `Subject: ${subject}`, `Message-ID: <${id}@nordlicht.de>`, `Date: ${new Date(Date.now() - 60_000).toUTCString()}`, extra, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", "Hallo, können wir starten? Grüße Lena"]
    .filter(Boolean)
    .join("\r\n");

describe.skipIf(!reachable)("IMAP/SMTP-Anbieter gegen echten Server", () => {
  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: true,
      disabledCommands: ["STARTTLS"],
      onAuth: (auth, _s, cb) => (auth.username === USER && auth.password === PASS ? cb(null, { user: USER }) : cb(new Error("Invalid login"))),
      onData: (stream, _s, cb) => {
        let data = "";
        stream.on("data", (d) => (data += d));
        stream.on("end", () => (delivered.push(data), cb()));
      },
    });
    await new Promise<void>((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
  });
  afterAll(async () => {
    setProviderFactory(null);
    await new Promise<void>((r) => smtp.close(() => r()));
  });
  beforeEach(async () => {
    await resetDb();
    setProviderFactory(null);
    delivered.length = 0;
    await clearMailbox();
  });

  async function account() {
    const [user] = await db.insert(schema.users).values({ email: `u${Date.now()}@test.de`, name: "Sarah Neumann" }).returning();
    const [acc] = await db
      .insert(schema.connectedAccounts)
      .values({ userId: user!.id, provider: "imap", emailAddress: USER, settings: settings as unknown as Record<string, unknown>, credentialsEnc: encrypt(PASS) })
      .returning();
    return { user: user!, acc: acc! };
  }

  it("prüft Zugangsdaten und erkennt falsche Passwörter", async () => {
    await expect(new ImapProvider(settings, PASS, USER).verify()).resolves.toBeUndefined();
    await expect(new ImapProvider(settings, "falsch", USER).verify()).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("synchronisiert, gruppiert Antworten, sendet, markiert und archiviert", async () => {
    await imap(async (c) => {
      await c.append("INBOX", raw("m1", "Projektplanung Q4"));
      await c.append("INBOX", raw("m2", "Re: Projektplanung Q4", "In-Reply-To: <m1@nordlicht.de>\r\nReferences: <m1@nordlicht.de>"));
    });
    const { user, acc } = await account();

    // Erstabgleich
    const first = await syncAccount(acc);
    expect(first).toMatchObject({ mode: "initial", fetched: 2 });
    const threads = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.accountId, acc.id));
    expect(threads).toHaveLength(1); // Antwort hängt an derselben Konversation
    expect(threads[0]!.messageCount).toBe(2);
    expect(threads[0]!.needsReply).toBe(true);
    expect(threads[0]!.unread).toBe(true);
    const labels = await db.select().from(schema.labels).where(eq(schema.labels.accountId, acc.id));
    expect(labels.map((l) => l.name)).toEqual(expect.arrayContaining(["INBOX", "Sent", "Archive"]));

    // Antworten: SMTP-Versand + Ablage in „Gesendet“ + gleicher Verlauf
    const [lastIncoming] = await db.select().from(schema.emails).where(and(eq(schema.emails.accountId, acc.id), eq(schema.emails.messageIdHeader, "<m2@nordlicht.de>")));
    const [freshAcc] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, acc.id));
    const sent = await sendEmail(user.id, { accountId: freshAcc!.id, to: [{ email: "lena@nordlicht.de" }], cc: [], subject: "Projektplanung Q4", body: "Ja, gern!", replyToEmailId: lastIncoming!.id }, "user");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("In-Reply-To: <m2@nordlicht.de>");
    expect(delivered[0]).toContain("References: <m1@nordlicht.de> <m2@nordlicht.de>");
    expect(sent.threadId).toBe(threads[0]!.id);
    const sentCount = await imap(async (c) => (await c.status("Sent", { messages: true })) as { messages: number });
    expect(sentCount.messages).toBe(1);
    const [afterSend] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.id, threads[0]!.id));
    expect(afterSend!.needsReply).toBe(false);
    expect(afterSend!.awaitingReplySince).not.toBeNull();

    // Als gelesen markieren → Flag auf dem Server
    await threadAction(user.id, threads[0]!.id, "read", "user");
    const unseen = await imap(async (c) => (await c.status("INBOX", { unseen: true })) as { unseen: number });
    expect(unseen.unseen).toBe(0);

    // Änderung außerhalb von Mailwin (z. B. am Handy wieder ungelesen) → Delta-Sync übernimmt sie
    await imap(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        await c.messageFlagsRemove("1:*", ["\\Seen"]);
      } finally {
        lock.release();
      }
    });
    const [acc2] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, acc.id));
    expect((await syncAccount(acc2!)).mode).toBe("delta");
    const [reUnread] = await db.select().from(schema.emailThreads).where(eq(schema.emailThreads.id, threads[0]!.id));
    expect(reUnread!.unread).toBe(true);

    // Neue Nachricht kommt an → Delta erkennt sie
    await imap((c) => c.append("INBOX", raw("m3", "Neue Anfrage")));
    const [acc3] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, acc.id));
    expect((await syncAccount(acc3!)).fetched).toBe(1);

    // Archivieren verschiebt in den Archiv-Ordner
    await threadAction(user.id, threads[0]!.id, "archive", "user");
    const status = await imap(async (c) => ({
      inbox: ((await c.status("INBOX", { messages: true })) as { messages: number }).messages,
      archive: ((await c.status("Archive", { messages: true })) as { messages: number }).messages,
    }));
    expect(status).toEqual({ inbox: 1, archive: 2 });
  });

  it("leitet Thread-IDs stabil aus den Headern ab", () => {
    const root = deriveThreadId({ messageId: "<a@x>" });
    expect(deriveThreadId({ inReplyTo: "<a@x>", messageId: "<b@x>" })).toBe(root);
    expect(deriveThreadId({ references: ["<a@x>", "<b@x>"], messageId: "<c@x>" })).toBe(root);
    expect(deriveThreadId({ messageId: "<z@x>" })).not.toBe(root);
  });
});
