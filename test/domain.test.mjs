import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, normalizeRules, noShowFee, needsHold, cancellationFee, compilePolicy } from "../lib/policy.mjs";
import { scoreRisk } from "../lib/risk.mjs";
import { planActions, holdHoursBefore } from "../lib/lifecycle.mjs";
import { placeHold, captureHold, releaseHold, HoldError } from "../lib/holds.mjs";

const H = 3_600_000;
const now = new Date("2026-10-20T15:00:00Z");
const at = (hours) => new Date(now.getTime() + hours * H).toISOString();

test("no-show fee is a percent of the price and never above it", () => {
  assert.equal(noShowFee(DEFAULT_RULES, 80), 40);
  const fixed = normalizeRules({ ...DEFAULT_RULES, no_show_fee: { kind: "fixed", value: 500 } });
  assert.equal(noShowFee(fixed, 80), 80);
});

test("normalizeRules clamps model output", () => {
  const r = normalizeRules({ no_show_fee: { kind: "percent", value: 250 }, late_cancel_window_hours: -5, late_cancel_fee: { kind: "bogus", value: 30 }, hold_for: "always", grace_minutes: 999 });
  assert.deepEqual([r.no_show_fee.value, r.late_cancel_window_hours, r.late_cancel_fee.kind, r.hold_for, r.grace_minutes], [100, 0, "percent", "medium_and_high", 120]);
});

test("cancellation is free outside the window and charged inside it", () => {
  assert.deepEqual(cancellationFee(DEFAULT_RULES, { price: 80, startAt: at(30), now }), { fee: 0, late: false, hoursBefore: 30 });
  assert.deepEqual(cancellationFee(DEFAULT_RULES, { price: 80, startAt: at(5), now }), { fee: 20, late: true, hoursBefore: 5 });
});

test("hold tiers follow the policy", () => {
  assert.equal(needsHold(DEFAULT_RULES, "low", 80), false);
  assert.equal(needsHold(DEFAULT_RULES, "medium", 80), true);
  assert.equal(needsHold({ ...DEFAULT_RULES, hold_for: "none" }, "high", 80), false);
  assert.equal(needsHold({ ...DEFAULT_RULES, no_show_fee: { kind: "percent", value: 0 } }, "high", 80), false);
});

test("risk: a regular is low, a first-timer with a past no-show on Friday evening is high", () => {
  const regular = scoreRisk({ client: { visits: 6, noShows: 0, lateCancels: 0 }, startAt: "2026-10-21T14:00:00Z", bookedAt: now });
  assert.equal(regular.tier, "low");
  const risky = scoreRisk({ client: { visits: 0, noShows: 1, lateCancels: 0 }, startAt: "2026-10-23T22:00:00Z", bookedAt: now });
  assert.equal(risky.tier, "high");
  assert.ok(risky.reasons.includes("Friday evening slot"), risky.reasons.join());
});

test("hold window stays inside PayPal's 3-day honor period", () => {
  assert.equal(holdHoursBefore(DEFAULT_RULES), 48);
  assert.equal(holdHoursBefore({ ...DEFAULT_RULES, late_cancel_window_hours: 200 }), 72);
});

const booking = (o) => ({ id: "b", status: "booked", startAt: at(10), price: 80, riskTier: "high", vaultId: "v1", checkedInAt: null, ...o });

test("lifecycle: hold goes on inside 48h, not before", () => {
  assert.deepEqual(planActions({ bookings: [booking({ startAt: at(60) })], rules: DEFAULT_RULES, now }), []);
  assert.deepEqual(planActions({ bookings: [booking({})], rules: DEFAULT_RULES, now }), [{ type: "place_hold", bookingId: "b", amount: 40 }]);
  assert.deepEqual(planActions({ bookings: [booking({ riskTier: "low" })], rules: DEFAULT_RULES, now }), []);
  assert.deepEqual(planActions({ bookings: [booking({ vaultId: null })], rules: DEFAULT_RULES, now }), []);
});

test("lifecycle: check-in releases, missing the grace period charges", () => {
  assert.deepEqual(planActions({ bookings: [booking({ status: "held", checkedInAt: now })], rules: DEFAULT_RULES, now }), [{ type: "release", bookingId: "b" }]);
  assert.deepEqual(planActions({ bookings: [booking({ status: "held", startAt: at(-0.2) })], rules: DEFAULT_RULES, now }), []);
  assert.deepEqual(planActions({ bookings: [booking({ status: "held", startAt: at(-0.3) })], rules: DEFAULT_RULES, now }), [{ type: "charge_no_show", bookingId: "b", amount: 40 }]);
  assert.deepEqual(planActions({ bookings: [booking({ status: "booked", startAt: at(-1) })], rules: DEFAULT_RULES, now }), [{ type: "mark_no_show", bookingId: "b" }]);
  assert.deepEqual(planActions({ bookings: [booking({ status: "awaiting_approval", startAt: at(-1) })], rules: DEFAULT_RULES, now }), [{ type: "expire", bookingId: "b" }]);
  assert.deepEqual(planActions({ bookings: [booking({ status: "charged", startAt: at(-1) })], rules: DEFAULT_RULES, now }), []);
});

function fakePayPal(responses) {
  const calls = [];
  return { calls, request: async (method, path, body, opts) => { calls.push({ method, path, body, opts }); return responses.shift() ?? {}; } };
}

test("placeHold authorizes from the vault with an idempotency key", async () => {
  const paypal = fakePayPal([{ id: "O1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "A1", status: "CREATED", expiration_time: "x" }] } }] }]);
  const h = await placeHold({ paypal, vaultId: "v1", amount: 40, bookingRef: "bk1", description: "Cut", requestId: "r1" });
  assert.deepEqual(h, { orderId: "O1", authorizationId: "A1", status: "CREATED", expiresAt: "x" });
  const c = paypal.calls[0];
  assert.equal(c.body.intent, "AUTHORIZE");
  assert.equal(c.body.payment_source.paypal.vault_id, "v1");
  assert.equal(c.body.purchase_units[0].amount.value, "40.00");
  assert.equal(c.opts.headers["PayPal-Request-Id"], "r1");
});

test("placeHold rejects a denied authorization", async () => {
  const paypal = fakePayPal([{ id: "O1", purchase_units: [{ payments: { authorizations: [{ id: "A1", status: "DENIED" }] } }] }]);
  await assert.rejects(placeHold({ paypal, vaultId: "v", amount: 1, bookingRef: "b", requestId: "r" }), (e) => e instanceof HoldError && e.code === "DECLINED");
});

test("captureHold is final, releaseHold voids", async () => {
  const paypal = fakePayPal([{ id: "C1", status: "COMPLETED", amount: { value: "20.00" } }, {}]);
  assert.deepEqual(await captureHold({ paypal, authorizationId: "A1", amount: 20, requestId: "r" }), { captureId: "C1", status: "COMPLETED", amount: 20 });
  assert.equal(paypal.calls[0].body.final_capture, true);
  await releaseHold({ paypal, authorizationId: "A1", requestId: "r2" });
  assert.equal(paypal.calls[1].path, "/v2/payments/authorizations/A1/void");
});

test("compilePolicy normalizes the model's rules (model faked)", async () => {
  const anthropic = { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { ...DEFAULT_RULES, no_show_fee: { kind: "percent", value: 140 } } }) } };
  const r = await compilePolicy({ anthropic, text: "Miss it, pay everything." });
  assert.equal(r.no_show_fee.value, 100);
  await assert.rejects(compilePolicy({ anthropic, text: "  " }));
});

import { describeEvent, verifyWebhook } from "../lib/webhook.mjs";

test("webhook: capture events map back to their authorization", () => {
  const cap = describeEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { amount: { value: "30.00" }, supplementary_data: { related_ids: { authorization_id: "A9" } } } });
  assert.deepEqual(cap, { authorizationId: "A9", message: "PayPal confirmed $30 was collected.", kind: "paypal_capture_completed" });
  assert.equal(describeEvent({ event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "A1" } }).authorizationId, "A1");
  assert.equal(describeEvent({ event_type: "INVOICING.INVOICE.PAID", resource: {} }), null);
});

test("webhook: unsigned or unverified requests are rejected", async () => {
  const headers = Object.fromEntries(["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"].map((h) => [h, "x"]));
  assert.equal((await verifyWebhook({ headers: {}, rawBody: "{}", webhookId: "W", paypal: {} })).status, 400);
  assert.equal((await verifyWebhook({ headers, rawBody: "{}", webhookId: "W", paypal: { verifyWebhookSignature: async () => false } })).status, 401);
  assert.equal((await verifyWebhook({ headers, rawBody: '{"id":"E1"}', webhookId: "W", paypal: { verifyWebhookSignature: async () => true } })).event.id, "E1");
});
