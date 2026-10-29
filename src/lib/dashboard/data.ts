import { and, asc, count, desc, eq, gte, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { addDays, formatTime, hourIn, sameDayIn, startOfDayIn, startOfWeekIn } from "../time";
import { buildGreeting, type Recommendation } from "./greeting";

const AWAITING_DAYS = 3;
const IMPORTANT_WINDOW_DAYS = 7;

async function userTz(userId: string) {
  const [u] = await db.select({ tz: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId));
  return u?.tz ?? "Europe/Berlin";
}

/** Kennzahlen für „Heute im Blick“ – auch von Marvin als Werkzeug genutzt. */
export async function getDailyOverview(userId: string) {
  const tz = await userTz(userId);
  const now = new Date();
  const today = startOfDayIn(now, tz);
  const tomorrow = startOfDayIn(addDays(today, 1.5), tz);

  const [[needsReply], [awaiting], [newToday], [openTasks], [tasksToday], eventsToday] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.emailThreads)
      .where(and(eq(schema.emailThreads.userId, userId), eq(schema.emailThreads.needsReply, true), gte(schema.emailThreads.lastMessageAt, addDays(now, -IMPORTANT_WINDOW_DAYS)))),
    db
      .select({ n: count() })
      .from(schema.emailThreads)
      .where(and(eq(schema.emailThreads.userId, userId), isNotNull(schema.emailThreads.awaitingReplySince), lte(schema.emailThreads.awaitingReplySince, addDays(now, -AWAITING_DAYS)))),
    db
      .select({ n: count() })
      .from(schema.emails)
      .where(and(eq(schema.emails.userId, userId), eq(schema.emails.isOutgoing, false), gte(schema.emails.receivedAt, today))),
    db.select({ n: count() }).from(schema.tasks).where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"))),
    db
      .select({ n: count() })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), lt(schema.tasks.dueAt, tomorrow))),
    db
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, userId), gte(schema.calendarEvents.endsAt, now), lt(schema.calendarEvents.startsAt, tomorrow)))
      .orderBy(asc(schema.calendarEvents.startsAt)),
  ]);

  return {
    needsReply: needsReply?.n ?? 0,
    awaitingReplyOver3Days: awaiting?.n ?? 0,
    newToday: newToday?.n ?? 0,
    openTasks: openTasks?.n ?? 0,
    tasksDueToday: tasksToday?.n ?? 0,
    eventsRemainingToday: eventsToday.length,
    nextEvent: eventsToday[0] ? { title: eventsToday[0].title, startsAt: eventsToday[0].startsAt, time: formatTime(eventsToday[0].startsAt, tz) } : null,
  };
}

export type WeekItem = { kind: "event" | "task" | "mail"; label: string };
export type WeekDay = { date: Date; isToday: boolean; items: WeekItem[] };

export async function getDashboardData(user: { id: string; name: string | null; timezone: string }, opts: { weekOffset?: number } = {}) {
  const tz = user.timezone;
  const now = new Date();
  const today = startOfDayIn(now, tz);
  const weekStart = startOfWeekIn(addDays(now, (opts.weekOffset ?? 0) * 7), tz);
  const weekEnd = startOfDayIn(addDays(weekStart, 5.5), tz); // Mo–Fr

  const [overview, accounts, weekEvents, weekTasks, weekMails, upcoming, projects, [activeProjects], pendingApprovals, autoSorted, oldestAwaiting] = await Promise.all([
    getDailyOverview(user.id),
    db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id)),
    db
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, user.id), gte(schema.calendarEvents.startsAt, weekStart), lt(schema.calendarEvents.startsAt, weekEnd)))
      .orderBy(asc(schema.calendarEvents.startsAt)),
    db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, user.id), ne(schema.tasks.status, "done"), gte(schema.tasks.dueAt, weekStart), lt(schema.tasks.dueAt, weekEnd))),
    db
      .select({ day: sql<string>`to_char(${schema.emailThreads.lastMessageAt} at time zone ${tz}, 'YYYY-MM-DD')`, n: count() })
      .from(schema.emailThreads)
      .where(and(eq(schema.emailThreads.userId, user.id), eq(schema.emailThreads.needsReply, true), gte(schema.emailThreads.lastMessageAt, weekStart), lt(schema.emailThreads.lastMessageAt, weekEnd)))
      .groupBy(sql`1`),
    db
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, user.id), gte(schema.calendarEvents.endsAt, now)))
      .orderBy(asc(schema.calendarEvents.startsAt))
      .limit(3),
    getProjectPulse(user.id),
    db
      .select({ n: count() })
      .from(schema.projects)
      .where(and(eq(schema.projects.userId, user.id), sql`${schema.projects.status} in ('planning','active','waiting')`)),
    db
      .select()
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.userId, user.id), eq(schema.approvalRequests.status, "pending")))
      .orderBy(desc(schema.approvalRequests.createdAt)),
    db
      .select({ n: count() })
      .from(schema.automationExecutions)
      .innerJoin(schema.automationRules, eq(schema.automationRules.id, schema.automationExecutions.ruleId))
      .where(and(eq(schema.automationRules.userId, user.id), eq(schema.automationExecutions.status, "success"), gte(schema.automationExecutions.createdAt, today))),
    db
      .select()
      .from(schema.emailThreads)
      .where(and(eq(schema.emailThreads.userId, user.id), isNotNull(schema.emailThreads.awaitingReplySince), lte(schema.emailThreads.awaitingReplySince, addDays(now, -AWAITING_DAYS))))
      .orderBy(asc(schema.emailThreads.awaitingReplySince))
      .limit(1),
  ]);

  const week: WeekDay[] = Array.from({ length: 5 }, (_, i) => {
    const date = startOfDayIn(addDays(weekStart, i + 0.5), tz);
    const items: WeekItem[] = [
      ...weekEvents.filter((e) => sameDayIn(e.startsAt, date, tz)).map((e) => ({ kind: "event" as const, label: e.title })),
      ...weekTasks.filter((t) => t.dueAt && sameDayIn(t.dueAt, date, tz)).map((t) => ({ kind: "task" as const, label: t.title })),
    ];
    const mails = weekMails.find((m) => m.day === date.toLocaleDateString("en-CA", { timeZone: tz }));
    if (mails?.n) items.push({ kind: "mail", label: `${mails.n} wichtige E-Mail${mails.n === 1 ? "" : "s"}` });
    return { date, isToday: sameDayIn(date, now, tz), items };
  });

  const recommendations: Recommendation[] = [];
  if (!accounts.length) {
    recommendations.push({ kind: "connect", text: "Verbinde dein erstes E-Mail-Konto, damit ich loslegen kann.", href: "/einstellungen" });
  }
  for (const a of accounts.filter((x) => x.status === "reauth_required")) {
    recommendations.push({ kind: "warning", text: `${a.emailAddress} muss neu verbunden werden.`, href: "/einstellungen" });
  }
  if (pendingApprovals.length) {
    recommendations.push({
      kind: "approval",
      text: `${pendingApprovals.length} ${pendingApprovals.length === 1 ? "Entwurf wartet" : "Entwürfe warten"} auf deine Freigabe.`,
      href: "/freigaben",
    });
  }
  if (oldestAwaiting[0]) {
    const days = Math.floor((now.getTime() - oldestAwaiting[0].awaitingReplySince!.getTime()) / 86_400_000);
    recommendations.push({
      kind: "followup",
      text: `„${oldestAwaiting[0].subject ?? "Ohne Betreff"}“ ist seit ${days} Tagen unbeantwortet. Soll ich ein Follow-up vorbereiten?`,
      href: `/marvin?prompt=${encodeURIComponent(`Bereite ein freundliches Follow-up für die Konversation „${oldestAwaiting[0].subject ?? ""}“ vor.`)}`,
    });
  }
  const conflicts = countOverlaps(weekEvents.filter((e) => e.endsAt >= now));
  if (conflicts) {
    recommendations.push({ kind: "calendar", text: `Du hast diese Woche ${conflicts} Termine mit Überschneidungen.` });
  }

  return {
    greeting: buildGreeting({ name: user.name, hour: hourIn(now, tz), overview, pendingApprovals: pendingApprovals.length }),
    dateLabel: now.toLocaleDateString("de-DE", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    overview,
    hasAccounts: accounts.length > 0,
    calendarConnected: accounts.some((a) => a.calendarEnabled),
    week,
    upcoming: upcoming.map((e) => ({
      id: e.id,
      title: e.title,
      sub: e.conferenceProvider ?? e.location ?? "",
      time: e.allDay ? "Ganztägig" : `${formatTime(e.startsAt, tz)} – ${formatTime(e.endsAt, tz)}`,
      now: e.startsAt <= now && e.endsAt > now,
    })),
    mail: {
      important: overview.needsReply,
      awaiting: overview.awaitingReplyOver3Days,
      newToday: overview.newToday,
      autoSorted: autoSorted[0]?.n ?? 0,
    },
    projects,
    activeProjects: activeProjects?.n ?? 0,
    pendingApprovals: pendingApprovals.length,
    recommendations,
  };
}

function countOverlaps(events: { startsAt: Date; endsAt: Date; allDay: boolean }[]) {
  const timed = events.filter((e) => !e.allDay);
  const involved = new Set<number>();
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      if (timed[i]!.startsAt < timed[j]!.endsAt && timed[j]!.startsAt < timed[i]!.endsAt) {
        involved.add(i);
        involved.add(j);
      }
  return involved.size;
}

export async function getProjectPulse(userId: string) {
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      description: schema.projects.description,
      status: schema.projects.status,
      total: sql<number>`count(${schema.tasks.id})::int`,
      done: sql<number>`count(${schema.tasks.id}) filter (where ${schema.tasks.status} = 'done')::int`,
    })
    .from(schema.projects)
    .leftJoin(schema.tasks, eq(schema.tasks.projectId, schema.projects.id))
    .where(and(eq(schema.projects.userId, userId), sql`${schema.projects.status} in ('planning','active','waiting')`))
    .groupBy(schema.projects.id)
    .orderBy(desc(schema.projects.updatedAt))
    .limit(3);
  return rows.map((r) => ({ ...r, progress: r.total ? Math.round((r.done / r.total) * 100) : 0 }));
}
