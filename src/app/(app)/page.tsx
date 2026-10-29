import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/dashboard/data";
import { Hero } from "@/components/dashboard/Hero";
import { MarvinCard } from "@/components/dashboard/MarvinCard";
import { WeekCard } from "@/components/dashboard/WeekCard";
import { UpcomingCard } from "@/components/dashboard/UpcomingCard";
import { MailOverview } from "@/components/dashboard/MailOverview";
import { ProjectPulse } from "@/components/dashboard/ProjectPulse";
import { QuickActions } from "@/components/dashboard/QuickActions";

export const metadata = { title: "Start" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ woche?: string }> }) {
  const user = await requireUser();
  const weekOffset = Math.max(-52, Math.min(52, Number((await searchParams).woche ?? 0) || 0));
  const d = await getDashboardData(user, { weekOffset });
  const activeProjects = d.activeProjects;

  return (
    <div className="stack">
      <div className="dash">
        <Hero
          dateLabel={d.dateLabel}
          greeting={d.greeting}
          tiles={[
            { href: "/emails?filter=antworten", value: String(d.overview.needsReply), label: "zu beantworten", ariaLabel: `${d.overview.needsReply} E-Mails benötigen eine Antwort` },
            {
              href: "/kalender",
              value: d.overview.nextEvent ? d.overview.nextEvent.time : "–",
              label: d.overview.nextEvent ? "nächster Termin" : "kein Termin",
              ariaLabel: d.overview.nextEvent ? `Nächster Termin ${d.overview.nextEvent.time}: ${d.overview.nextEvent.title}` : "Heute keine Termine mehr",
            },
            { href: "/aufgaben", value: String(d.overview.openTasks), label: d.overview.tasksDueToday ? `${d.overview.tasksDueToday} heute fällig` : "Aufgaben offen", ariaLabel: `${d.overview.openTasks} offene Aufgaben` },
            { href: "/projekte", value: String(activeProjects), label: activeProjects === 1 ? "Projekt aktiv" : "Projekte aktiv", ariaLabel: `${activeProjects} aktive Projekte` },
          ]}
        />
        <MarvinCard recommendations={d.recommendations} />
      </div>
      <div className="dash-row-2">
        <WeekCard week={d.week} offset={weekOffset} timezone={user.timezone} calendarConnected={d.calendarConnected} />
        <UpcomingCard items={d.upcoming} />
      </div>
      <div className="dash-row-3">
        <MailOverview mail={d.mail} />
        <ProjectPulse projects={d.projects} />
      </div>
      <QuickActions />
    </div>
  );
}
