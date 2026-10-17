// End-to-end over the real schema and queries (SQLite, the same dialect as Cloudflare D1)
// with PayPal faked.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "./sqlite.mjs";

const skip = false;
let ops, store, seed, db;

function fakePayPal() {
  const calls = [];
  let n = 0;
  return {
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (path === "/v3/vault/setup-tokens") return { id: "ST1", links: [{ rel: "approve", href: "https://sandbox.paypal.com/approve" }] };
      if (path.startsWith("/v3/vault/setup-tokens/")) return { id: "ST1", status: "APPROVED" };
      if (path === "/v3/vault/payment-tokens") return { id: "VAULT1", payment_source: { paypal: { email_address: "buyer@example.com" } } };
      if (path === "/v2/checkout/orders") return { id: `O${++n}`, status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: `A${n}`, status: "CREATED", expiration_time: "2026-11-20T00:00:00Z" }] } }] };
      if (path.endsWith("/capture")) return { id: `C${n}`, status: "COMPLETED", amount: { value: body.amount.value } };
      if (path.endsWith("/void")) return {};
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}

before(async () => {
  delete process.env.DEMO_VAULT_ID;
  db = sqliteDatabase();
  globalThis.__holdslotDb = db;
  store = await import("../lib/server/db.mjs");
  ops = await import("../lib/server/ops.mjs");
  seed = await import("../lib/server/seed.mjs");
  assert.equal(await seed.seedIfEmpty(db), true);
  assert.equal(await seed.seedIfEmpty(db), false);
});

async function bookTomorrow({ email, name, hour = 15 }) {
  const settings = await store.getSettings(db);
  const now = ops.clockNow(settings);
  const day = new Date(now.getTime() + 4 * 86_400_000).toISOString().slice(0, 10);
  const slots = await ops.findSlots({ date: day, serviceId: "cut" });
  assert.ok(slots.length > 0, "slots offered");
  const slot = slots.find((s) => new Date(s.startAt).getUTCHours() >= hour) ?? slots[0];
  return ops.createBooking({ serviceId: "cut", staffId: slot.staffId, startAt: slot.startAt, name, email });
}

test("first-time client: approve once, hold at T-48h, charged on a no-show", { skip }, async () => {
  const paypal = fakePayPal();
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client" });
  assert.equal(bk.needsApproval, true);
  assert.equal(bk.holdAmount, 30);

  const { approveUrl, nonce } = await ops.startApproval({ paypal, publicId: bk.publicId, appUrl: "http://x" });
  assert.match(approveUrl, /approve/);
  assert.equal(await ops.completeApproval({ paypal, nonce }), bk.publicId);
  assert.equal(await ops.completeApproval({ paypal, nonce }), bk.publicId, "reload is harmless");
  assert.equal((await store.getBooking(bk.id, db)).status, "booked");
  assert.equal(paypal.calls.filter((c) => c.path === "/v3/vault/payment-tokens").length, 1);

  const b0 = await store.getBooking(bk.id, db);
  const hoursTo = (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000;
  await ops.advanceClock({ paypal, hours: hoursTo - 47 });
  const held = await store.getBooking(bk.id, db);
  assert.equal(held.status, "held");
  assert.ok(held.authorizationId);

  await ops.advanceClock({ paypal, hours: 47.5 });
  const charged = await store.getBooking(bk.id, db);
  assert.equal(charged.status, "charged");
  assert.equal(charged.chargedAmount, 30);
  const cap = paypal.calls.find((c) => c.path.endsWith("/capture"));
  assert.equal(cap.body.final_capture, true);
  const client = (await db.query("SELECT no_shows FROM clients WHERE email = 'new@example.com'")).rows[0];
  assert.equal(client.no_shows, 1);
});

test("returning client with a vault: no new approval; check-in voids the hold", { skip }, async () => {
  const paypal = fakePayPal();
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 17 });
  assert.equal(bk.needsApproval, false, "vault reused");
  assert.equal(bk.risk.tier, "high", "the earlier no-show raises risk");
  const b0 = await store.getBooking(bk.id, db);
  await ops.advanceClock({ paypal, hours: (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000 - 1 });
  assert.equal((await store.getBooking(bk.id, db)).status, "held");
  await ops.checkIn({ paypal, bookingId: bk.id });
  const done = await store.getBooking(bk.id, db);
  assert.equal(done.status, "released");
  assert.ok(paypal.calls.some((c) => c.path.endsWith("/void")));
});

test("late cancel takes the late fee from the hold; early cancel is free", { skip }, async () => {
  const paypal = fakePayPal();
  const late = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 14 });
  const b0 = await store.getBooking(late.id, db);
  await ops.advanceClock({ paypal, hours: (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000 - 5 });
  assert.equal((await store.getBooking(late.id, db)).status, "held");
  const after = await ops.cancelBooking({ paypal, publicId: late.publicId });
  assert.equal(after.status, "charged");
  assert.equal(after.chargedAmount, 15);

  const early = await bookTomorrow({ email: "other@example.com", name: "Other" });
  const c = await ops.cancelBooking({ paypal, publicId: early.publicId });
  assert.equal(c.status, "cancelled");
  assert.equal(c.chargedAmount, 0);
});

test("once the slot has started, the client can't cancel their way to a smaller fee", { skip }, async () => {
  const paypal = fakePayPal();
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 12 });
  const b0 = await store.getBooking(bk.id, db);
  await ops.advanceClock({ paypal, hours: (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000 + 0.1 });
  assert.equal((await store.getBooking(bk.id, db)).status, "held", "inside the grace period, not yet settled");
  await assert.rejects(ops.cancelBooking({ paypal, publicId: bk.publicId }), (err) => err.code === "STARTED");
  assert.equal((await store.getBooking(bk.id, db)).status, "held");
  assert.ok(!paypal.calls.some((c) => c.path.endsWith("/capture")), "nothing captured");
});

test("a slot can't be double-booked", { skip }, async () => {
  const settings = await store.getSettings(db);
  const day = new Date(ops.clockNow(settings).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  const [slot] = await ops.findSlots({ date: day, serviceId: "color" });
  await ops.createBooking({ serviceId: "color", staffId: slot.staffId, startAt: slot.startAt, name: "A", email: "a@example.com" });
  await assert.rejects(ops.createBooking({ serviceId: "color", staffId: slot.staffId, startAt: slot.startAt, name: "B", email: "b@example.com" }), /taken/);
});

test("one big clock jump still holds before it charges", { skip }, async () => {
  const paypal = fakePayPal();
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 16 });
  const b0 = await store.getBooking(bk.id, db);
  const hoursTo = (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000;
  await ops.advanceClock({ paypal, hours: hoursTo + 2 });
  const b = await store.getBooking(bk.id, db);
  assert.equal(b.status, "charged", "placed the hold on the way, then charged the no-show");
});

test("a PayPal outage while placing a hold is retried, not marked declined", { skip }, async () => {
  const ok = fakePayPal();
  const down = { request: async () => { throw new Error("PayPal POST /v2/checkout/orders failed: 503"); } };
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 13 });
  const b0 = await store.getBooking(bk.id, db);
  const hoursTo = (new Date(b0.startAt) - ops.clockNow(await store.getSettings(db))) / 3_600_000;
  await ops.advanceClock({ paypal: down, hours: hoursTo - 40 });
  assert.equal((await store.getBooking(bk.id, db)).status, "booked");
  await ops.runSweep({ paypal: ok });
  assert.equal((await store.getBooking(bk.id, db)).status, "held");
});

test("check-in is refused hours before the slot", { skip }, async () => {
  const bk = await bookTomorrow({ email: "new@example.com", name: "New Client", hour: 18 }); // has a vault, so "booked"
  await assert.rejects(ops.checkIn({ paypal: fakePayPal(), bookingId: bk.id }), /2 hours before/);
});

test("reset demo re-seeds and rewinds the clock", { skip }, async () => {
  await store.saveSettings({ rules: { ...(await store.getSettings(db)).rules, grace_minutes: 99 } }, db);
  await seed.resetDemo(db);
  const s = await store.getSettings(db);
  assert.equal(s.clockOffsetMs, 0);
  assert.equal(s.rules.grace_minutes, 15, "a judge's policy edit is undone by reset");
  assert.equal((await store.openBookings(db)).length, 6);
});
