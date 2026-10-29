import { randomBytes } from "node:crypto";
import type { Address, OutgoingMessage } from "./types";

// ───────────── Adressen ─────────────

/** Zerlegt einen Header wie `"Müller, Thomas" <t@x.de>, anna@y.de` in Adressen. */
export function parseAddressList(header: string | null | undefined): Address[] {
  if (!header) return [];
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") depth++;
    else if (!inQuotes && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && !inQuotes && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map(parseAddress).filter((a): a is Address => a !== null);
}

export function parseAddress(raw: string): Address | null {
  const value = raw.trim();
  if (!value) return null;
  const angle = value.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').trim();
    return { email: angle[2]!.trim().toLowerCase(), ...(name ? { name } : {}) };
  }
  return value.includes("@") ? { email: value.toLowerCase() } : null;
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const needsEncoding = /[^\x20-\x7e]/.test(a.name);
  const name = needsEncoding ? encodeHeaderWord(a.name) : `"${a.name.replace(/(["\\])/g, "\\$1")}"`;
  return `${name} <${a.email}>`;
}

// ───────────── Header-Kodierung (RFC 2047) ─────────────

export function encodeHeaderWord(value: string): string {
  if (!/[^\x20-\x7e]/.test(value)) return value;
  // In Blöcke teilen, damit encoded-words unter 75 Zeichen bleiben, ohne UTF-8-Sequenzen zu zerschneiden
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** Dekodiert RFC-2047-Wörter (Gmail liefert Header meist schon dekodiert, IMAP nicht). */
export function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      return decodeBytes(bytes, charset);
    });
}

export function decodeBytes(bytes: Buffer, charset: string | null | undefined): string {
  const cs = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "us-ascii" ? "utf-8" : cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ───────────── Nachricht bauen ─────────────

function wrapBase64(data: Buffer): string {
  return data.toString("base64").replace(/.{76}/g, "$&\r\n");
}

function boundary(): string {
  return `mw_${randomBytes(12).toString("hex")}`;
}

function textPart(contentType: string, content: string): string {
  return [`Content-Type: ${contentType}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrapBase64(Buffer.from(content, "utf8"))].join("\r\n");
}

/** Erzeugt eine RFC-5322-Nachricht (CRLF) inkl. Alternativ-Teil und Anhängen. */
export function buildMimeMessage(msg: OutgoingMessage, opts: { messageId?: string; date?: Date } = {}): string {
  const domain = msg.from.email.split("@")[1] ?? "mailwin.local";
  const headers: string[] = [
    `From: ${formatAddress(msg.from)}`,
    `To: ${msg.to.map(formatAddress).join(", ")}`,
  ];
  if (msg.cc?.length) headers.push(`Cc: ${msg.cc.map(formatAddress).join(", ")}`);
  if (msg.bcc?.length) headers.push(`Bcc: ${msg.bcc.map(formatAddress).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderWord(msg.subject)}`);
  headers.push(`Date: ${(opts.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`);
  headers.push(`Message-ID: ${opts.messageId ?? `<${randomBytes(16).toString("hex")}@${domain}>`}`);
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${msg.inReplyTo}`);
  const refs = [...(msg.references ?? []), ...(msg.inReplyTo && !msg.references?.includes(msg.inReplyTo) ? [msg.inReplyTo] : [])];
  if (refs.length) headers.push(`References: ${refs.join(" ")}`);
  headers.push("MIME-Version: 1.0");

  const body = msg.html
    ? (() => {
        const b = boundary();
        return {
          type: `multipart/alternative; boundary="${b}"`,
          content: [`--${b}`, textPart("text/plain", msg.text), `--${b}`, textPart("text/html", msg.html), `--${b}--`].join("\r\n"),
        };
      })()
    : null;

  if (!msg.attachments?.length) {
    if (body) return [...headers, `Content-Type: ${body.type}`, "", body.content].join("\r\n");
    return [...headers, textPart("text/plain", msg.text)].join("\r\n");
  }

  const mixed = boundary();
  const parts = [body ? `Content-Type: ${body.type}\r\n\r\n${body.content}` : textPart("text/plain", msg.text)];
  for (const att of msg.attachments) {
    const name = encodeHeaderWord(att.filename);
    parts.push(
      [
        `Content-Type: ${att.mimeType}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(att.content),
      ].join("\r\n"),
    );
  }
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    ...parts.flatMap((p) => [`--${mixed}`, p]),
    `--${mixed}--`,
  ].join("\r\n");
}

/** „Re: “ nur einmal voranstellen. */
export function replySubject(subject: string): string {
  return /^(re|aw|antw)\s*:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Entfernt HTML für Vorschau und KI-Kontext (keine Sicherheitsgrenze – Anzeige erfolgt sandboxed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
