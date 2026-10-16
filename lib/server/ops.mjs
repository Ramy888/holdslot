// Everything that changes a booking: booking, PayPal approval, the hold sweep,
// check-in, cancellation, and the demo clock. PayPal and the database are passed in.
import { createHash, randomBytes } from "node:crypto";
import * as store from "./db.mjs";
import { scoreRisk, explainRisk } from "../risk.mjs";
import { cancellationFee, needsHold, noShowFee } from "../policy.mjs";
import { planActions } from "../lifecycle.mjs";
import { placeHold, releaseHold, captureHold, HoldError } from "../holds.mjs";
import { formatSlot, openSlots, localDate } from "../slots.mjs";

export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const token = (bytes) => randomBytes(bytes).toString("base64url");
const usd = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, "")}`;
const APPROVAL_TTL_MS = 60 * 60_000;

/** The app's clock: real time plus the demo offset the owner can move forward. */
export const clockNow = (settings) => new Date(Date.now() + settings.clockOffsetMs);

export async function findSlots({ date, serviceId }, db = store.database()) {
  const settings = await store.getSettings(db);
  const now = clockNow(settings);
  const services = await store.listServices(db);
  const service = services.find((s) => s.id === serviceId);
  if (!service) throw new BookingError("NO_SERVICE", `Unknown service "${serviceId}".`);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : localDate(now, settings.timeZone);
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + 2 * 86_400_000);
  const slots = openSlots({ date: day, durationMin: service.durationMin, staff: await store.listStaff(db), busy: await store.busyFor({ from, to }, db), timeZone: settings.timeZone, now });
  return slots.map((s) => ({ ...s, label: formatSlot(s.startAt, settings.timeZone) }));
}

/**
 * Books a slot. A hold is needed when the policy says so for this client's risk tier;
 * a client who approved PayPal before is not asked again.
 */
export async function createBooking({ serviceId, staffId, startAt, name, email, source = "chat" }, db = store.database()) {
  const settings = await store.getSettings(db);
  const now = clockNow(settings);
  const service = (await store.listServices(db)).find((s) => s.id === serviceId);
  if (!service) throw new BookingError("NO_SERVICE", "Choose one of the services.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) throw new BookingError("BAD_EMAIL", "An email address is needed to book.");
  if (!String(name ?? "").trim()) throw new BookingError("NO_NAME", "A name is needed to book.");
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime()) || start.getTime() < now.getTime() + 30 * 60_000) throw new BookingError("BAD_TIME", "That time has passed or is too soon.");
  const end = new Date(start.getTime() + service.durationMin * 60_000);
  const staff = await store.listStaff(db);
  if (!staff.some((s) => s.id === staffId)) throw new BookingError("NO_STAFF", "Unknown stylist.");
  if ((await store.busyFor({ staffId, from: start, to: end }, db)).length) throw new BookingError("TAKEN", "That slot was just taken. Pick another.");

  const client = await store.upsertClient({ name: String(name).trim(), email }, db);
  const risk = scoreRisk({ client, startAt: start, bookedAt: now, timeZone: settings.timeZone });
  const hold = needsHold(settings.rules, risk.tier, service.price);
  const holdAmount = hold ? noShowFee(settings.rules, service.price) : 0;
  const status = hold && !client.vaultId ? "awaiting_approval" : "booked";
  const publicId = token(9);
  const id = await store.insertBooking(
    { publicId, clientId: client.id, serviceId, staffId, startAt: start, endAt: end, price: service.price, status, riskScore: risk.score, riskTier: risk.tier, riskReasons: risk.reasons, holdAmount, source, bookedAt: now },
    db,
  );
  const holdNote = hold
    ? `${usd(holdAmount)} will be held 48 hours before (not charged) and released when ${client.name} arrives.`
    : "No deposit needed.";
  await store.logActivity({ bookingId: id, at: now, kind: "booked", message: `${service.name} on ${formatSlot(start, settings.timeZone)}. ${explainRisk(risk)} ${holdNote}` }, db);
  return { id, publicId, status, risk, holdAmount, service, startLabel: formatSlot(start, settings.timeZone), needsApproval: status === "awaiting_approval" };
}

/** Starts the one-time PayPal approval. The nonce goes in an httpOnly cookie. */
export async function startApproval({ paypal, publicId, appUrl }, db = store.database()) {
  const settings = await store.getSettings(db);
  const b = await store.getBookingByPublicId(publicId, db);
  if (!b || b.status !== "awaiting_approval") throw new BookingError("NOT_PENDING", "This booking doesn't need a PayPal approval.");
  const st = await paypal.request("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: `${settings.businessName}: no-show or late-cancel fee only, up to ${usd(b.holdAmount)} per visit`.slice(0, 127),
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: true,
        experience_context: { brand_name: settings.businessName.slice(0, 127), return_url: `${appUrl}/approve/return`, cancel_url: `${appUrl}/b/${publicId}?cancelled=1` },
      },
    },
  });
  const approveUrl = st.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new BookingError("PAYPAL_UNAVAILABLE", "PayPal did not return an approval link.");
  const nonce = token(32);
  await store.insertPending({ setupTokenId: st.id, nonceHash: sha256(nonce), bookingId: b.id, expiresAt: new Date(Date.now() + APPROVAL_TTL_MS) }, db);
  return { approveUrl, nonce };
}

/** Finishes the approval for the browser holding `nonce`; returns the booking's public id. */
export async function completeApproval({ paypal, nonce }, db = store.database()) {
  const pending = nonce ? await store.findPending(sha256(nonce), db) : null;
  if (!pending) throw new BookingError("NO_PENDING", "We couldn't find an approval started in this browser.");
  const b = await store.getBooking(pending.bookingId, db);
  if (pending.usedAt) return b.publicId; // a reload of the return page: already done
  if (new Date(pending.expiresAt) <= new Date()) throw new BookingError("EXPIRED", "This approval expired. Please start again.");
  const st = await paypal.request("GET", `/v3/vault/setup-tokens/${encodeURIComponent(pending.setupTokenId)}`);
  if (st.status !== "APPROVED") throw new BookingError("NOT_APPROVED", "PayPal has not confirmed the approval.");
  if (!(await store.markPendingUsed(pending.id, db))) return b.publicId;
  const pt = await paypal.request("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: pending.setupTokenId, type: "SETUP_TOKEN" } } });
  if (!pt.id) throw new BookingError("PAYPAL_UNAVAILABLE", "PayPal did not return the saved account.");
  await store.setClientVault(b.clientId, { vaultId: pt.id, paypalEmail: pt.payment_source?.paypal?.email_address ?? null }, db);
  const settings = await store.getSettings(db);
  if (await store.transitionBooking(b.id, ["awaiting_approval"], { status: "booked" }, db)) {
    await store.logActivity({ bookingId: b.id, at: clockNow(settings), kind: "approved", message: `${b.clientName} approved PayPal for a fee of up to ${usd(b.holdAmount)}. Nothing is held yet.` }, db);
  }
  await runSweep({ paypal }, db); // the slot may already be inside the hold window
  return b.publicId;
}


/**
 * Applies every action the lifecycle planner asks for. Returns what was done.
 * @param {{ paypal: any, only?: string }} opts `only`: limit to one booking id
 */
export async function runSweep({ paypal, only }, db = store.database()) {
  if (!(await store.takeSweepLease(new Date(), db))) return [];
  try {
    const settings = await store.getSettings(db);
    const now = clockNow(settings);
    const bookings = (await store.openBookings(db)).filter((b) => !only || b.id === only);
    const done = [];
    for (const action of planActions({ bookings, rules: settings.rules, now })) {
      const b = bookings.find((x) => x.id === action.bookingId);
      try {
        done.push(await applyAction({ paypal, action, booking: b, settings, now }, db));
      } catch (err) {
        console.error(JSON.stringify({ msg: "sweep action failed", type: action.type, bookingId: b.id, error: String(err.message ?? err) }));
        await store.logActivity({ bookingId: b.id, at: now, kind: "error", message: `Could not ${action.type.replace(/_/g, " ")}: ${err.message}` }, db);
      }
    }
    return done;
  } finally {
    await store.releaseSweepLease(db);
  }
}

async function applyAction({ paypal, action, booking: b, settings, now }, db) {
  const when = formatSlot(b.startAt, settings.timeZone);
  switch (action.type) {
    case "place_hold": {
      try {
        const h = await placeHold({ paypal, vaultId: b.vaultId, amount: action.amount, bookingRef: b.publicId, description: `${b.serviceName}, ${when}: held, not charged`, requestId: `hold-${b.id}` });
        if (await store.transitionBooking(b.id, ["booked"], { status: "held", orderId: h.orderId, authorizationId: h.authorizationId, holdExpiresAt: h.expiresAt }, db)) {
          await store.logActivity({ bookingId: b.id, at: now, kind: "held", message: `Held ${usd(action.amount)} on ${b.clientName}'s PayPal for ${when}. Not charged; released when they arrive.`, amount: action.amount }, db);
        }
      } catch (err) {
        // Only a real decline closes the door. Anything else (PayPal down, a timeout) is thrown so the
        // sweep logs it and tries again next minute with the same request id.
        if (!(err instanceof HoldError)) throw err;
        if (await store.transitionBooking(b.id, ["booked"], { status: "hold_failed" }, db)) {
          await store.logActivity({ bookingId: b.id, at: now, kind: "hold_failed", message: `PayPal declined the ${usd(action.amount)} hold for ${b.clientName}: ${err.message}. Call to confirm, or keep the slot without a deposit.` }, db);
        }
      }
      return action;
    }
    case "release": {
      if (b.status === "held") await releaseHold({ paypal, authorizationId: b.authorizationId, requestId: `void-${b.id}` });
      if (await store.transitionBooking(b.id, [b.status], { status: "released", checkedInAt: b.checkedInAt ?? now }, db)) {
        await store.bumpClient(b.clientId, "visits", db);
        await store.logActivity({ bookingId: b.id, at: now, kind: "released", message: b.status === "held" ? `${b.clientName} arrived. Released the ${usd(b.holdAmount)} hold; nothing charged.` : `${b.clientName} arrived.`, amount: b.status === "held" ? b.holdAmount : null }, db);
      }
      return action;
    }
    case "charge_no_show": {
      const c = await captureHold({ paypal, authorizationId: b.authorizationId, amount: action.amount, note: `Missed appointment: ${b.serviceName}, ${when}`, requestId: `capture-${b.id}` });
      if (await store.transitionBooking(b.id, ["held"], { status: "charged", captureId: c.captureId, chargedAmount: c.amount }, db)) {
        await store.bumpClient(b.clientId, "noShows", db);
        await store.logActivity({ bookingId: b.id, at: now, kind: "charged", message: `${b.clientName} didn't come and didn't cancel (${settings.rules.grace_minutes} min grace passed). Charged the ${usd(c.amount)} no-show fee from the hold, as the policy says.`, amount: c.amount }, db);
      }
      return action;
    }
    case "mark_no_show": {
      if (await store.transitionBooking(b.id, ["booked", "hold_failed"], { status: "no_show" }, db)) {
        await store.bumpClient(b.clientId, "noShows", db);
        await store.logActivity({ bookingId: b.id, at: now, kind: "no_show", message: `${b.clientName} didn't come. No hold was needed for this booking, so nothing was charged; their next booking will score higher risk.` }, db);
      }
      return action;
    }
    case "expire": {
      if (await store.transitionBooking(b.id, ["awaiting_approval"], { status: "cancelled", cancelledAt: now }, db)) {
        await store.logActivity({ bookingId: b.id, at: now, kind: "expired", message: `${b.clientName} never approved the deposit; the slot was freed.` }, db);
      }
      return action;
    }
  }
}

/** Front desk: the client is here. Releases the hold right away. */
export async function checkIn({ paypal, bookingId }, db = store.database()) {
  const settings = await store.getSettings(db);
  const b = await store.getBooking(bookingId, db);
  if (!b || !["booked", "held", "hold_failed"].includes(b.status)) throw new BookingError("NOT_OPEN", "This booking is already closed.");
  await store.transitionBooking(b.id, [b.status], { checkedInAt: clockNow(settings) }, db);
  return runSweep({ paypal, only: b.id }, db);
}

/** Owner: the client didn't come. Charges now instead of waiting for the grace period. */
export async function markNoShow({ paypal, bookingId }, db = store.database()) {
  const settings = await store.getSettings(db);
  const b = await store.getBooking(bookingId, db);
  if (!b || !["booked", "held", "hold_failed"].includes(b.status)) throw new BookingError("NOT_OPEN", "This booking is already closed.");
  const now = clockNow(settings);
  if (now < new Date(b.startAt)) throw new BookingError("TOO_EARLY", "The appointment hasn't started yet.");
  const action = b.status === "held" ? { type: "charge_no_show", bookingId: b.id, amount: noShowFee(settings.rules, b.price) } : { type: "mark_no_show", bookingId: b.id };
  await applyAction({ paypal, action, booking: b, settings, now }, db);
}

/** Client cancels. Free outside the policy window; inside it, the late fee comes out of the hold. */
export async function cancelBooking({ paypal, publicId }, db = store.database()) {
  const settings = await store.getSettings(db);
  const now = clockNow(settings);
  const b = await store.getBookingByPublicId(publicId, db);
  if (!b || !["awaiting_approval", "booked", "held", "hold_failed"].includes(b.status)) throw new BookingError("NOT_OPEN", "This booking can't be cancelled.");
  const { fee, late, hoursBefore } = cancellationFee(settings.rules, { price: b.price, startAt: b.startAt, now });
  const rule = `${settings.rules.late_cancel_window_hours}h`;
  let message;
  if (b.status === "held" && late && fee > 0) {
    const c = await captureHold({ paypal, authorizationId: b.authorizationId, amount: Math.min(fee, b.holdAmount), note: `Late cancellation: ${b.serviceName}`, requestId: `capture-${b.id}` });
    if (!(await store.transitionBooking(b.id, ["held"], { status: "charged", captureId: c.captureId, chargedAmount: c.amount, cancelledAt: now }, db))) return b;
    await store.bumpClient(b.clientId, "lateCancels", db);
    message = `${b.clientName} cancelled ${hoursBefore}h before (inside the ${rule} window). Charged the ${usd(c.amount)} late-cancel fee and released the rest of the ${usd(b.holdAmount)} hold.`;
    await store.logActivity({ bookingId: b.id, at: now, kind: "charged", message, amount: c.amount }, db);
  } else {
    if (b.status === "held") await releaseHold({ paypal, authorizationId: b.authorizationId, requestId: `void-${b.id}` });
    if (!(await store.transitionBooking(b.id, [b.status], { status: "cancelled", cancelledAt: now }, db))) return b;
    if (late) await store.bumpClient(b.clientId, "lateCancels", db);
    message = late
      ? `${b.clientName} cancelled ${hoursBefore}h before, inside the ${rule} window, but there was no hold to take a fee from. Nothing charged.`
      : `${b.clientName} cancelled ${hoursBefore}h before, in time. ${b.status === "held" ? "Released the hold; nothing charged." : "Nothing charged."}`;
    await store.logActivity({ bookingId: b.id, at: now, kind: "cancelled", message }, db);
  }
  return store.getBookingByPublicId(publicId, db);
}

// The demo clock moves in steps no longer than this, sweeping after each, so a long jump
// still places each hold (48h before) before it settles the slot.
const CLOCK_STEP_MS = 3 * 3_600_000;

/** Demo clock: moves "now" forward so judges can watch a week happen in a minute. */
export async function advanceClock({ paypal, hours }, db = store.database()) {
  let left = Math.round(Math.min(Math.max(Number(hours) || 0, 0), 24 * 14) * 3_600_000);
  const done = [];
  while (left > 0) {
    const step = Math.min(left, CLOCK_STEP_MS);
    const settings = await store.getSettings(db);
    await store.saveSettings({ clockOffsetMs: settings.clockOffsetMs + step }, db);
    done.push(...(await runSweep({ paypal }, db)));
    left -= step;
  }
  return done;
}
