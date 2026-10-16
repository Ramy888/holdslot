// Open appointment slots, computed in the business's time zone. Pure.

export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 19;
const STEP_MIN = 30;

/** UTC instant for a wall-clock time in `timeZone` (e.g. 2026-10-23 18:00 in New York). */
export function zonedTime(dateStr, hour, minute, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const offset = (t) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  // Two passes settle the offset across a DST change.
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

/** "YYYY-MM-DD" of an instant in `timeZone`. */
export const localDate = (instant, timeZone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

export const formatSlot = (instant, timeZone) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(instant));

/**
 * @param {{ date: string, durationMin: number, staff: Array<{id: string, name: string}>,
 *   busy: Array<{staffId: string, startAt: Date|string, endAt: Date|string}>, timeZone: string, now: Date, limit?: number }} input
 * @returns {Array<{ staffId: string, staffName: string, startAt: string, endAt: string }>}
 */
export function openSlots({ date, durationMin, staff, busy, timeZone, now, limit = 24 }) {
  const out = [];
  const close = zonedTime(date, CLOSE_HOUR, 0, timeZone).getTime();
  const earliest = now.getTime() + 60 * 60_000; // at least an hour's notice
  for (let min = OPEN_HOUR * 60; min + durationMin <= CLOSE_HOUR * 60; min += STEP_MIN) {
    const start = zonedTime(date, Math.floor(min / 60), min % 60, timeZone).getTime();
    const end = start + durationMin * 60_000;
    if (start < earliest || end > close) continue;
    for (const s of staff) {
      const clash = busy.some((b) => b.staffId === s.id && new Date(b.startAt).getTime() < end && new Date(b.endAt).getTime() > start);
      if (!clash) {
        out.push({ staffId: s.id, staffName: s.name, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() });
        break; // one stylist per time is enough to offer
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}
