import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

/** Format: scrypt$N$r$p$salt$hash (base64url) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Mindestanforderungen – bewusst Länge statt Sonderzeichen-Regeln. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return "Das Passwort muss mindestens 10 Zeichen lang sein.";
  if (password.length > 200) return "Das Passwort ist zu lang.";
  if (email && password.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Das Passwort darf nicht deine E-Mail-Adresse enthalten.";
  if (/^(.)\1+$/.test(password)) return "Das Passwort ist zu einfach.";
  return null;
}

/** Gut lesbares Startpasswort, z. B. „Kafo-7mxq-Rupe-42tz“. */
export function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const groups = [0, 4, 8, 12].map((o) => Array.from(bytes.subarray(o, o + 4), (b) => alphabet[b % alphabet.length]).join(""));
  return groups.map((g, i) => (i % 2 === 0 ? g[0]!.toUpperCase() + g.slice(1) : g)).join("-");
}
