/** Zeitzonen-Hilfen ohne zusätzliche Abhängigkeit. */

function partsIn(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

/** Versatz der Zeitzone zu UTC in Minuten zum gegebenen Zeitpunkt. */
function offsetMinutes(date: Date, timeZone: string) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Mitternacht (lokal in `timeZone`) des Tages, auf den `date` fällt – als UTC-Zeitpunkt. */
export function startOfDayIn(date: Date, timeZone: string): Date {
  const p = partsIn(date, timeZone);
  const guess = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
}

export function addDays(date: Date, days: number): Date {
  // Über die Tagesgrenze in der Zeitzone neu berechnen ist bei Sommerzeit robuster; für Tagesfenster reicht +24h-Rundung
  return new Date(date.getTime() + days * 86_400_000);
}

/** Montag 00:00 der Woche (lokal). */
export function startOfWeekIn(date: Date, timeZone: string): Date {
  const start = startOfDayIn(date, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return startOfDayIn(addDays(start, -idx + 0.5), timeZone);
}

export function hourIn(date: Date, timeZone: string): number {
  return partsIn(date, timeZone).h;
}

export function formatTime(date: Date, timeZone: string) {
  return date.toLocaleTimeString("de-DE", { timeZone, hour: "2-digit", minute: "2-digit" });
}

export function sameDayIn(a: Date, b: Date, timeZone: string) {
  return startOfDayIn(a, timeZone).getTime() === startOfDayIn(b, timeZone).getTime();
}
