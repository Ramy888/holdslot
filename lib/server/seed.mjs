// Demo business: two stylists, four services, and a week of bookings from clients
// with made-up histories (example.com addresses). Bookings are placed relative to
// the app's clock so the demo always starts "this week".
import { randomBytes } from "node:crypto";
import { newId, toParam } from "./db.mjs";
import { DEFAULT_POLICY_TEXT, DEFAULT_RULES, needsHold, noShowFee } from "../policy.mjs";
import { scoreRisk } from "../risk.mjs";
import { zonedTime, localDate } from "../slots.mjs";

const TZ = "America/New_York";

const STAFF = [
  ["maya", "Maya", "#0f766e"],
  ["leo", "Leo", "#7c3aed"],
];
const SERVICES = [
  ["trim", "Beard trim", 30, 35],
  ["cut", "Haircut", 45, 60],
  ["blowout", "Blowout", 45, 55],
  ["color", "Color", 120, 160],
];
// [name, email, visits, noShows, lateCancels, hasApprovedPayPal]
const CLIENTS = [
  ["Dana Whitfield", "dana@example.com", 9, 0, 0, false],
  ["Marcus Bell", "marcus@example.com", 2, 1, 1, true],
  ["Priya Nair", "priya@example.com", 0, 0, 0, true],
  ["Tom Alvarez", "tom@example.com", 4, 0, 1, true],
  ["Jess Okafor", "jess@example.com", 1, 2, 0, true],
];
// [client index, service, staff, days from today, hour, minute]
const BOOKINGS = [
  [0, "cut", "maya", 0, 16, 0],
  [1, "color", "leo", 1, 10, 0],
  [2, "cut", "maya", 1, 17, 30],
  [3, "blowout", "leo", 2, 11, 0],
  [4, "cut", "maya", 3, 18, 0],
  [0, "trim", "leo", 5, 9, 30],
];

export async function seedIfEmpty(db) {
  const { rows } = await db.query("SELECT 1 FROM settings WHERE id = 1");
  if (rows.length) return false;
  await seedBusiness(db);
  await seedBookings(db, 0);
  return true;
}

async function seedBusiness(db) {
  await db.query("INSERT OR IGNORE INTO settings (id, policy_text, rules) VALUES (1, ?1, ?2)", [DEFAULT_POLICY_TEXT, toParam(DEFAULT_RULES)]);
  for (const [id, name, color] of STAFF) await db.query("INSERT OR IGNORE INTO staff (id, name, color) VALUES (?1,?2,?3)", [id, name, color]);
  for (const [id, name, min, price] of SERVICES) {
    await db.query("INSERT OR IGNORE INTO services (id, name, duration_min, price) VALUES (?1,?2,?3,?4)", [id, name, min, price]);
  }
}

/** Fresh clients and bookings around the app clock. Used by the seed and by "Reset demo". */
export async function seedBookings(db, clockOffsetMs) {
  const now = new Date(Date.now() + clockOffsetMs);
  const { rows: s } = await db.query("SELECT rules FROM settings WHERE id = 1");
  const rules = JSON.parse(s[0].rules);
  const demoVault = process.env.DEMO_VAULT_ID || null;
  const clientIds = [];
  for (const [name, email, visits, noShows, lateCancels, approved] of CLIENTS) {
    const { rows: c } = await db.query(
      `INSERT INTO clients (id, name, email, visits, no_shows, late_cancels, vault_id, paypal_email)
       VALUES (?8,?1,?2,?3,?4,?5,?6,?7)
       ON CONFLICT (email) DO UPDATE SET visits=?3, no_shows=?4, late_cancels=?5, vault_id=?6, paypal_email=?7 RETURNING id`,
      [name, email, visits, noShows, lateCancels, approved ? demoVault : null, approved && demoVault ? "sandbox buyer (shared demo account)" : null, newId()],
    );
    clientIds.push({ id: c[0].id, visits, noShows, lateCancels, approved });
  }
  const today = localDate(now, TZ);
  const svc = Object.fromEntries(SERVICES.map(([id, , min, price]) => [id, { min, price }]));
  for (const [ci, serviceId, staffId, days, hour, minute] of BOOKINGS) {
    const day = localDate(new Date(zonedTime(today, 12, 0, TZ).getTime() + days * 86_400_000), TZ);
    let start = zonedTime(day, hour, minute, TZ);
    if (start.getTime() < now.getTime() + 2 * 3_600_000) start = new Date(now.getTime() + (2 + ci) * 3_600_000); // today's slot already passed
    const end = new Date(start.getTime() + svc[serviceId].min * 60_000);
    const client = clientIds[ci];
    const bookedAt = new Date(now.getTime() - (3 + ci) * 86_400_000);
    const risk = scoreRisk({ client, startAt: start, bookedAt, timeZone: TZ });
    const hold = needsHold(rules, risk.tier, svc[serviceId].price);
    const status = hold && !(client.approved && demoVault) ? "awaiting_approval" : "booked";
    const id = newId();
    await db.query(
      `INSERT INTO bookings (id, public_id, client_id, service_id, staff_id, start_at, end_at, price, status, risk_score, risk_tier, risk_reasons, hold_amount, source, booked_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'seed',?14)`,
      [id, randomBytes(9).toString("base64url"), client.id, serviceId, staffId, start, end, svc[serviceId].price, status, risk.score, risk.tier, risk.reasons, hold ? noShowFee(rules, svc[serviceId].price) : 0, bookedAt].map(toParam),
    );
    await db.query("INSERT INTO activity (booking_id, at, kind, message) VALUES (?1,?2,'booked',?3)", [id, toParam(bookedAt), `Demo booking. Risk ${risk.tier}: ${risk.reasons.join(", ")}.`]);
  }
}

/** "Reset demo": clears bookings and activity, resets the clock, re-seeds. Keeps the policy. */
export async function resetDemo(db) {
  for (const t of ["activity", "pending_approvals", "webhook_events", "bookings", "clients"]) await db.query(`DELETE FROM ${t}`);
  await db.query("UPDATE settings SET clock_offset_ms = 0 WHERE id = 1");
  await seedBookings(db, 0);
}
