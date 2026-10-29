export type Recommendation = {
  kind: "connect" | "warning" | "approval" | "followup" | "calendar";
  text: string;
  href?: string;
};

interface GreetingInput {
  name: string | null;
  hour: number;
  overview: {
    needsReply: number;
    awaitingReplyOver3Days: number;
    eventsRemainingToday: number;
    tasksDueToday: number;
  };
  pendingApprovals: number;
}

const plural = (n: number, one: string, many: string) => `${n === 0 ? "keine" : n} ${n === 1 ? one : many}`;

/** Marvins Begrüßung in der Sprechblase – ausschließlich aus echten Zahlen gebildet. */
export function buildGreeting({ name, hour, overview, pendingApprovals }: GreetingInput): { title: string; text: string } {
  const salutation = hour < 5 ? "Hallo" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";
  const first = name?.split(" ")[0];
  const title = `${salutation}${first ? `, ${first}` : ""}!`;

  const parts: string[] = [];
  if (overview.needsReply) parts.push(plural(overview.needsReply, "E-Mail wartet", "E-Mails warten") + " auf deine Antwort");
  if (overview.eventsRemainingToday) parts.push(plural(overview.eventsRemainingToday, "Termin steht", "Termine stehen") + " heute noch an");
  if (overview.tasksDueToday) parts.push(plural(overview.tasksDueToday, "Aufgabe ist", "Aufgaben sind") + " heute fällig");
  if (pendingApprovals) parts.push(plural(pendingApprovals, "Entwurf liegt", "Entwürfe liegen") + " zur Freigabe bereit");

  let text: string;
  if (!parts.length) {
    text = overview.awaitingReplyOver3Days
      ? `Heute ist nichts Dringendes offen. Bei ${plural(overview.awaitingReplyOver3Days, "Konversation", "Konversationen")} wartest du allerdings seit über drei Tagen auf Antwort.`
      : "Heute ist nichts Dringendes offen. Sag mir einfach, was ich für dich erledigen soll.";
  } else {
    const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
    text = `Hier ist dein Überblick: ${list[0]!.toUpperCase()}${list.slice(1)}.`;
    if (overview.awaitingReplyOver3Days) {
      const n = overview.awaitingReplyOver3Days;
      text += ` Außerdem wartest du bei ${n === 1 ? "einer Anfrage" : `${n} Anfragen`} seit über drei Tagen auf Antwort.`;
    }
  }
  return { title, text };
}
