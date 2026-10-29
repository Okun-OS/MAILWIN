import type { Address } from "../db/schema";

export function initialsOf(a: Address | null | undefined) {
  const base = a?.name || a?.email || "?";
  return base
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

export function displayName(a: Address | null | undefined) {
  return a?.name || a?.email || "Unbekannt";
}

/** „09:42“, „Gestern“, „Mo.“ oder „12. Okt.“ – wie im Mail-Client üblich. */
export function relativeDate(date: Date | null | undefined, timeZone: string) {
  if (!date) return "";
  const now = new Date();
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  if (day(date) === day(now)) return date.toLocaleTimeString("de-DE", { timeZone, hour: "2-digit", minute: "2-digit" });
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return "Gestern";
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString("de-DE", { timeZone, weekday: "short" });
  return date.toLocaleDateString("de-DE", { timeZone, day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
