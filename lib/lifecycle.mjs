// What should happen to each booking now. Pure: takes bookings, the rules and the
// clock, returns actions. lib/server/sweep.ts carries them out against PayPal.
//
// Booking statuses:
//   awaiting_approval  a hold is needed and the client hasn't approved PayPal yet
//   booked             confirmed; a hold may be placed later
//   held               PayPal authorization in place
//   released           client came, hold voided (or there was none)
//   charged            no-show fee or late-cancel fee captured
//   cancelled          cancelled in time, nothing charged
//   no_show            missed, but there was no hold to charge
//   hold_failed        PayPal declined the hold; the owner decides
import { noShowFee, needsHold } from "./policy.mjs";

// PayPal guarantees an authorization's funds for 3 days (the honor period), so the
// hold goes on inside that window, and early enough to cover the late-cancel window.
export const MAX_HOLD_HOURS = 72;
export const holdHoursBefore = (rules) => Math.min(MAX_HOLD_HOURS, Math.max(48, rules.late_cancel_window_hours + 24));

/** When the hold goes on, in client words: inside the hold window it is placed right away. */
export function holdWhen(rules, startAt, now) {
  const hours = holdHoursBefore(rules);
  return new Date(startAt).getTime() - new Date(now).getTime() <= hours * 3_600_000 ? "as soon as PayPal is approved" : `${hours} hours before the visit`;
}

export const OPEN = new Set(["awaiting_approval", "booked", "held", "hold_failed"]);

/**
 * @param {{ bookings: Array<{ id: string, status: string, startAt: string|Date, price: number,
 *   riskTier: string, vaultId: string|null, checkedInAt: string|Date|null }>, rules: any, now: Date }} input
 * @returns {Array<{ type: "place_hold"|"release"|"charge_no_show"|"mark_no_show"|"expire", bookingId: string, amount?: number }>}
 */
export function planActions({ bookings, rules, now }) {
  const t = now.getTime();
  const holdMs = holdHoursBefore(rules) * 3_600_000;
  const graceMs = rules.grace_minutes * 60_000;
  const actions = [];
  for (const b of bookings) {
    if (!OPEN.has(b.status)) continue;
    const start = new Date(b.startAt).getTime();
    const held = b.status === "held";
    const wantsHold = needsHold(rules, b.riskTier, b.price);

    if (b.checkedInAt) {
      actions.push({ type: "release", bookingId: b.id });
    } else if (t >= start + graceMs) {
      if (b.status === "awaiting_approval") actions.push({ type: "expire", bookingId: b.id });
      else if (held) actions.push({ type: "charge_no_show", bookingId: b.id, amount: noShowFee(rules, b.price) });
      else actions.push({ type: "mark_no_show", bookingId: b.id }); // nothing held, so nothing to charge
    } else if (b.status === "booked" && wantsHold && b.vaultId && start - t <= holdMs) {
      actions.push({ type: "place_hold", bookingId: b.id, amount: noShowFee(rules, b.price) });
    }
  }
  return actions;
}
