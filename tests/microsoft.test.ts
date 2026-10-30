import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { MicrosoftProvider, normalizeGraphMessage } from "@/lib/mail/microsoft";
import { microsoftTokenGetter } from "@/lib/mail/accounts";
import { ReauthRequiredError } from "@/lib/mail/types";
import { resetDb } from "./helpers";

const folders = { inbox: "F-INBOX", sent: "F-SENT" };

/** Minimale Nachbildung der Graph-API: Pfad-Präfix → Antwort */
function mockFetch(routes: Record<string, (url: string, init?: RequestInit) => unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(`kein Mock für ${url}`, { status: 404 });
    const body = routes[key]!(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Graph-Nachrichten", () => {
  it("wandelt Nachrichten inkl. Kategorien, Lesestatus und References um", () => {
    const m = normalizeGraphMessage(
      {
        id: "AAMk1",
        conversationId: "CONV1",
        internetMessageId: "<b@x>",
        subject: "Angebot",
        bodyPreview: "Hallo",
        body: { contentType: "html", content: "<p>Hallo<br>Welt</p>" },
        from: { emailAddress: { name: "Thomas Müller", address: "T.Mueller@MP.de" } },
        toRecipients: [{ emailAddress: { address: "sarah@okun.de" } }],
        receivedDateTime: "2026-10-30T09:00:00Z",
        isRead: false,
        flag: { flagStatus: "flagged" },
        parentFolderId: "F-INBOX",
        categories: ["Kunden"],
        internetMessageHeaders: [{ name: "References", value: "<a@x>" }],
      },
      folders,
    );
    expect(m.from).toEqual({ name: "Thomas Müller", email: "t.mueller@mp.de" });
    expect(m.providerThreadId).toBe("CONV1");
    expect(m.labelIds).toEqual(["INBOX", "Kunden", "UNREAD", "STARRED"]);
    expect(m.bodyText).toBe("Hallo\nWelt");
    expect(m.references).toEqual(["<a@x>"]);
    expect(m.isOutgoing).toBe(false);
  });
});

describe("MicrosoftProvider", () => {
  it("Erstabgleich und Delta: neue, geänderte und gelöschte Nachrichten", async () => {
    let round = 0;
    mockFetch({
      "/mailFolders/inbox/messages/delta": () => ({ value: [{ id: "m1", receivedDateTime: "2026-10-29T10:00:00Z" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-inbox-1" }),
      "/mailFolders/sentitems/messages/delta": () => ({ value: [{ id: "s1", receivedDateTime: "2026-10-30T10:00:00Z" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-sent-1" }),
      "delta-inbox-1": () => (round++, { value: [{ id: "m2" }, { id: "m1", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-inbox-2" }),
      "delta-sent-1": () => ({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-sent-2" }),
    });
    const p = new MicrosoftProvider(async () => "token");
    const cursor = await p.currentCursor();
    expect(JSON.parse(cursor)).toEqual({ inbox: "https://graph.microsoft.com/v1.0/delta-inbox-1", sentitems: "https://graph.microsoft.com/v1.0/delta-sent-1" });
    expect((await p.listMessageIds()).ids).toEqual(["s1", "m1"]);
    const changes = await p.changesSince(cursor);
    expect(changes).toMatchObject({ kind: "delta", changedMessageIds: ["m2"], deletedMessageIds: ["m1"] });
    expect(round).toBe(1);
  });

  it("verlangt bei abgelaufenem Delta-Token einen Neuabgleich", async () => {
    mockFetch({ "delta-alt": () => new Response('{"error":{"code":"syncStateNotFound"}}', { status: 410 }) });
    const p = new MicrosoftProvider(async () => "token");
    expect(await p.changesSince(JSON.stringify({ inbox: "https://graph.microsoft.com/v1.0/delta-alt", sentitems: "x" }))).toEqual({ kind: "reset" });
  });

  it("sendet MIME und findet die Nachricht in „Gesendete Elemente“", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 200 });
    const calls = mockFetch({
      "/me/sendMail": () => new Response(null, { status: 202 }),
      "/mailFolders/sentitems/messages?": () => ({ value: [{ id: "sent-1", conversationId: "CONV1" }] }),
    });
    const p = new MicrosoftProvider(async () => "token");
    const res = await p.send({ from: { email: "sarah@okun.de" }, to: [{ email: "lena@x.de" }], subject: "Test", text: "Hallo", inReplyTo: "<a@x>" });
    vi.useRealTimers();
    expect(res).toEqual({ providerMessageId: "sent-1", providerThreadId: "CONV1" });
    const mime = Buffer.from(String(calls[0]!.init!.body), "base64").toString("utf8");
    expect(mime).toContain("In-Reply-To: <a@x>");
    expect((calls[0]!.init!.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
  });

  it("meldet 401 als „neu verbinden“", async () => {
    mockFetch({ "/me/messages/": () => new Response("", { status: 401 }), "/me/mailFolders/": () => ({ id: "x" }) });
    await expect(new MicrosoftProvider(async () => "token").getMessage("m1")).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});

describe("Microsoft-Token", () => {
  beforeEach(resetDb);

  it("erneuert abgelaufene Token und speichert das neue Refresh-Token verschlüsselt", async () => {
    (env as Record<string, unknown>).MICROSOFT_CLIENT_ID = "cid";
    (env as Record<string, unknown>).MICROSOFT_CLIENT_SECRET = "secret";
    const [u] = await db.insert(schema.users).values({ email: "ms@test.de" }).returning();
    const [acc] = await db
      .insert(schema.connectedAccounts)
      .values({ userId: u!.id, provider: "microsoft", emailAddress: "ms@test.de", accessTokenEnc: encrypt("alt"), refreshTokenEnc: encrypt("refresh-1"), tokenExpiresAt: new Date(Date.now() - 1000) })
      .returning();
    const calls = mockFetch({ "/oauth2/v2.0/token": () => ({ access_token: "neu", refresh_token: "refresh-2", expires_in: 3600 }) });
    const get = microsoftTokenGetter(acc!);
    expect(await get()).toBe("neu");
    expect(await get()).toBe("neu");
    expect(calls).toHaveLength(1); // zweiter Aufruf nutzt das zwischengespeicherte Token
    expect(String(calls[0]!.init!.body)).toContain("grant_type=refresh_token");
    const [stored] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, acc!.id));
    expect(decrypt(stored!.refreshTokenEnc!)).toBe("refresh-2");
    expect(stored!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("widerrufener Zugriff führt zu „neu verbinden“", async () => {
    (env as Record<string, unknown>).MICROSOFT_CLIENT_ID = "cid";
    (env as Record<string, unknown>).MICROSOFT_CLIENT_SECRET = "secret";
    const [u] = await db.insert(schema.users).values({ email: "ms2@test.de" }).returning();
    const [acc] = await db.insert(schema.connectedAccounts).values({ userId: u!.id, provider: "microsoft", emailAddress: "ms2@test.de", refreshTokenEnc: encrypt("r") }).returning();
    mockFetch({ "/oauth2/v2.0/token": () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "revoked" }), { status: 400 }) });
    await expect(microsoftTokenGetter(acc!)()).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});
