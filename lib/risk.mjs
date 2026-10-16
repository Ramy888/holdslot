// No-show risk for one booking: a transparent points score, so the owner and the
// client can both see why a hold was (or wasn't) asked for. No model involved.

/**
 * @param {{ client: { visits: number, noShows: number, lateCancels: number },
 *   startAt: string | Date, bookedAt: string | Date, timeZone?: string }} input
 * @returns {{ score: number, tier: "low" | "medium" | "high", reasons: string[] }}
 */
export function scoreRisk({ client, startAt, bookedAt, timeZone = "America/New_York" }) {
  const start = new Date(startAt);
  const leadDays = (start.getTime() - new Date(bookedAt).getTime()) / 86_400_000;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(start)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const weekendEvening = (parts.weekday === "Fri" || parts.weekday === "Sat") && hour >= 17;

  let score = 10;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (client.noShows > 0) add(Math.min(client.noShows * 30, 60), `missed ${client.noShows} appointment${client.noShows > 1 ? "s" : ""} before`);
  if (client.lateCancels > 0) add(Math.min(client.lateCancels * 10, 20), `cancelled late ${client.lateCancels} time${client.lateCancels > 1 ? "s" : ""}`);
  if (client.visits === 0) add(20, "first visit");
  if (leadDays > 14) add(15, `booked ${Math.round(leadDays)} days ahead`);
  if (weekendEvening) add(10, `${parts.weekday === "Fri" ? "Friday" : "Saturday"} evening slot`);
  if (client.visits >= 3 && client.noShows === 0) add(-25, `${client.visits} visits, never missed one`);

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 55 ? "high" : score >= 30 ? "medium" : "low";
  if (!reasons.length) reasons.push("no risk signals");
  return { score, tier, reasons };
}

export const explainRisk = ({ tier, reasons }) => `${tier[0].toUpperCase()}${tier.slice(1)} risk: ${reasons.join(", ")}.`;
