// The database: Cloudflare D1 (SQLite) on Workers, and the queries the app uses.
// Everything goes through a tiny `{ query(sql, params) }` interface so tests can run the
// same SQL on Node's built-in SQLite (see test/sqlite.mjs).

const CF_CONTEXT = Symbol.for("__cloudflare-context__");
const ISO_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** D1 can't bind Dates, arrays or undefined; store them as ISO strings, JSON and NULL. */
export const toParam = (v) => (v instanceof Date ? v.toISOString() : Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v === undefined ? null : v);

const RETURNS_ROWS = /^\s*(select|with)\b|\breturning\b/i;

/** Wraps a D1 binding as `{ query }`. */
export function d1Database(d1) {
  return {
    async query(sql, params = []) {
      const stmt = d1.prepare(sql).bind(...params.map(toParam));
      const res = await stmt.all();
      return { rows: res.results ?? [], rowCount: RETURNS_ROWS.test(sql) ? (res.results ?? []).length : (res.meta?.changes ?? 0) };
    },
  };
}

/** The database for this request: the Worker's D1 binding, or one a test installed. */
export function database() {
  const cf = globalThis[CF_CONTEXT];
  if (cf?.env?.DB) {
    cf.holdslotDb ??= d1Database(cf.env.DB);
    return cf.holdslotDb;
  }
  if (globalThis.__holdslotDb) return globalThis.__holdslotDb;
  throw new Error("No database: run under Wrangler (D1 binding DB) or install one for tests.");
}

const num = (v) => (v == null ? null : Number(v));
const date = (v) => (v == null ? null : new Date(v));
export const newId = () => crypto.randomUUID();

/**
 * @typedef {{ id: string, publicId: string, clientId: string, clientName: string, clientEmail: string, vaultId: string|null,
 *   serviceId: string, serviceName: string, staffId: string, startAt: Date, endAt: Date, price: number, status: string,
 *   riskScore: number, riskTier: string, riskReasons: string[], holdAmount: number, orderId: string|null,
 *   authorizationId: string|null, holdExpiresAt: Date|null, captureId: string|null, chargedAmount: number,
 *   checkedInAt: Date|null, cancelledAt: Date|null, source: string, bookedAt: Date }} Booking
 * @typedef {{ businessName: string, timeZone: string, currency: string, policyText: string,
 *   rules: ReturnType<typeof import("../policy.mjs").normalizeRules>, clockOffsetMs: number }} Settings
 * @typedef {{ id: string, name: string, durationMin: number, price: number }} Service
 * @typedef {{ id: number, bookingId: string|null, at: Date, kind: string, message: string, amount: number|null, clientName: string|null }} Activity
 */

/** @returns {Booking} */
export const toBooking = (r) =>
  r && {
    id: r.id,
    publicId: r.public_id,
    clientId: r.client_id,
    clientName: r.client_name,
    clientEmail: r.client_email,
    vaultId: r.vault_id ?? null,
    serviceId: r.service_id,
    serviceName: r.service_name,
    staffId: r.staff_id,
    startAt: date(r.start_at),
    endAt: date(r.end_at),
    price: num(r.price),
    status: r.status,
    riskScore: r.risk_score,
    riskTier: r.risk_tier,
    riskReasons: JSON.parse(r.risk_reasons ?? "[]"),
    holdAmount: num(r.hold_amount),
    orderId: r.order_id,
    authorizationId: r.authorization_id,
    holdExpiresAt: date(r.hold_expires_at),
    captureId: r.capture_id,
    chargedAmount: num(r.charged_amount),
    checkedInAt: date(r.checked_in_at),
    cancelledAt: date(r.cancelled_at),
    source: r.source,
    bookedAt: date(r.booked_at),
  };

const BOOKING_SELECT = `
  SELECT b.*, c.name AS client_name, c.email AS client_email, c.vault_id, s.name AS service_name
  FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id`;

/** @returns {Promise<Settings>} */
export async function getSettings(db = database()) {
  let { rows } = await db.query("SELECT * FROM settings WHERE id = 1");
  if (!rows[0]) {
    // First request on a fresh database: create the demo business.
    const { seedIfEmpty } = await import("./seed.mjs");
    await seedIfEmpty(db);
    ({ rows } = await db.query("SELECT * FROM settings WHERE id = 1"));
  }
  const r = rows[0];
  return {
    businessName: r.business_name,
    timeZone: r.time_zone,
    currency: r.currency,
    policyText: r.policy_text,
    rules: JSON.parse(r.rules),
    clockOffsetMs: Number(r.clock_offset_ms),
  };
}

export async function saveSettings(patch, db = database()) {
  const cols = { policyText: "policy_text", rules: "rules", clockOffsetMs: "clock_offset_ms", businessName: "business_name" };
  const keys = Object.keys(patch).filter((k) => cols[k]);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${cols[k]} = ?${i + 1}`).join(", ");
  await db.query(`UPDATE settings SET ${sets}, updated_at = ${ISO_NOW} WHERE id = 1`, keys.map((k) => patch[k]));
}

/** @returns {Promise<{ id: string, name: string, color: string }[]>} */
export async function listStaff(db = database()) {
  return (await db.query("SELECT id, name, color FROM staff ORDER BY id")).rows;
}

/** @returns {Promise<Service[]>} */
export async function listServices(db = database()) {
  const { rows } = await db.query("SELECT id, name, duration_min, price FROM services ORDER BY price");
  return rows.map((r) => ({ id: r.id, name: r.name, durationMin: r.duration_min, price: Number(r.price) }));
}

/** @param {{ from: Date, to: Date }} range @returns {Promise<Booking[]>} */
export async function listBookings({ from, to }, db = database()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.end_at >= ?1 AND b.start_at <= ?2 ORDER BY b.start_at`, [from, to]);
  return rows.map(toBooking);
}

/** @returns {Promise<Booking[]>} */
export async function openBookings(db = database()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.status IN ('awaiting_approval','booked','held','hold_failed') ORDER BY b.start_at`);
  return rows.map(toBooking);
}

/** @returns {Promise<Booking|null>} */
export async function getBooking(id, db = database()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = ?1`, [id]);
  return toBooking(rows[0]);
}

/** @param {string} publicId @returns {Promise<Booking|null>} */
export async function getBookingByPublicId(publicId, db = database()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.public_id = ?1`, [publicId]);
  return toBooking(rows[0]);
}

/** Bookings that overlap [start, end) on a staff member, ignoring finished or cancelled ones. */
export async function busyFor({ staffId, from, to }, db = database()) {
  const { rows } = await db.query(
    `SELECT staff_id, start_at, end_at FROM bookings
     WHERE status IN ('awaiting_approval','booked','held','hold_failed','released','charged','no_show')
       AND start_at < ?2 AND end_at > ?1 AND (?3 IS NULL OR staff_id = ?3)`,
    [from, to, staffId ?? null],
  );
  return rows.map((r) => ({ staffId: r.staff_id, startAt: r.start_at, endAt: r.end_at }));
}

export async function upsertClient({ name, email }, db = database()) {
  const { rows } = await db.query(
    `INSERT INTO clients (id, name, email) VALUES (?1, ?2, lower(?3))
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), clients.name)
     RETURNING id, name, email, visits, no_shows, late_cancels, vault_id`,
    [newId(), name, email],
  );
  const r = rows[0];
  return { id: r.id, name: r.name, email: r.email, visits: r.visits, noShows: r.no_shows, lateCancels: r.late_cancels, vaultId: r.vault_id };
}

export async function insertBooking(b, db = database()) {
  const id = newId();
  await db.query(
    `INSERT INTO bookings (id, public_id, client_id, service_id, staff_id, start_at, end_at, price, status,
       risk_score, risk_tier, risk_reasons, hold_amount, source, booked_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`,
    [id, b.publicId, b.clientId, b.serviceId, b.staffId, b.startAt, b.endAt, b.price, b.status, b.riskScore, b.riskTier, b.riskReasons, b.holdAmount, b.source, b.bookedAt],
  );
  return id;
}

const BOOKING_COLS = {
  status: "status",
  orderId: "order_id",
  authorizationId: "authorization_id",
  holdExpiresAt: "hold_expires_at",
  captureId: "capture_id",
  chargedAmount: "charged_amount",
  checkedInAt: "checked_in_at",
  cancelledAt: "cancelled_at",
};

/**
 * Updates a booking only if it is still in one of `fromStatuses`, so two sweeps (or a sweep and a
 * click) can't both act on it. Returns false when someone else got there first.
 */
export async function transitionBooking(id, fromStatuses, patch, db = database()) {
  const keys = Object.keys(patch).filter((k) => BOOKING_COLS[k]);
  const sets = keys.map((k, i) => `${BOOKING_COLS[k]} = ?${i + 2}`);
  const from = fromStatuses.map((_, i) => `?${keys.length + 2 + i}`).join(", ");
  const { rowCount } = await db.query(
    `UPDATE bookings SET ${[...sets, `updated_at = ${ISO_NOW}`].join(", ")} WHERE id = ?1 AND status IN (${from})`,
    [id, ...keys.map((k) => patch[k]), ...fromStatuses],
  );
  return rowCount === 1;
}

export async function bumpClient(clientId, field, db = database()) {
  const col = { visits: "visits", noShows: "no_shows", lateCancels: "late_cancels" }[field];
  await db.query(`UPDATE clients SET ${col} = ${col} + 1 WHERE id = ?1`, [clientId]);
}

export async function setClientVault(clientId, { vaultId, paypalEmail }, db = database()) {
  await db.query("UPDATE clients SET vault_id = ?2, paypal_email = ?3 WHERE id = ?1", [clientId, vaultId, paypalEmail]);
}

export async function logActivity({ bookingId, at, kind, message, amount = null }, db = database()) {
  await db.query("INSERT INTO activity (booking_id, at, kind, message, amount) VALUES (?1,?2,?3,?4,?5)", [bookingId, at, kind, message, amount]);
}

/** @returns {Promise<Activity[]>} */
export async function recentActivity(limit = 30, db = database()) {
  const { rows } = await db.query(
    `SELECT a.id, a.booking_id, a.at, a.kind, a.message, a.amount, c.name AS client_name
     FROM activity a LEFT JOIN bookings b ON b.id = a.booking_id LEFT JOIN clients c ON c.id = b.client_id
     ORDER BY a.id DESC LIMIT ?1`,
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), bookingId: r.booking_id, at: date(r.at), kind: r.kind, message: r.message, amount: num(r.amount), clientName: r.client_name }));
}

/** @param {string} bookingId @returns {Promise<{ at: Date, kind: string, message: string, amount: number|null }[]>} */
export async function bookingActivity(bookingId, db = database()) {
  const { rows } = await db.query("SELECT at, kind, message, amount FROM activity WHERE booking_id = ?1 ORDER BY id", [bookingId]);
  return rows.map((r) => ({ at: date(r.at), kind: r.kind, message: r.message, amount: num(r.amount) }));
}

export async function insertPending({ setupTokenId, nonceHash, bookingId, expiresAt }, db = database()) {
  await db.query("INSERT INTO pending_approvals (id, setup_token_id, nonce_hash, booking_id, expires_at) VALUES (?1,?2,?3,?4,?5)", [newId(), setupTokenId, nonceHash, bookingId, expiresAt]);
}

export async function findPending(nonceHash, db = database()) {
  const { rows } = await db.query("SELECT * FROM pending_approvals WHERE nonce_hash = ?1", [nonceHash]);
  const r = rows[0];
  return r && { id: r.id, setupTokenId: r.setup_token_id, bookingId: r.booking_id, expiresAt: date(r.expires_at), usedAt: date(r.used_at) };
}

/** Marks the approval used; false if another request already did (double-clicked return link). */
export async function markPendingUsed(id, db = database()) {
  const { rowCount } = await db.query(`UPDATE pending_approvals SET used_at = ${ISO_NOW} WHERE id = ?1 AND used_at IS NULL`, [id]);
  return rowCount === 1;
}

/** A marker that changes whenever a booking, the activity log or the demo clock changes. */
export async function changeMark(db = database()) {
  const { rows } = await db.query(
    `SELECT (SELECT coalesce(max(id), 0) FROM activity) || ':' ||
            (SELECT coalesce(max(updated_at), '') FROM bookings) || ':' ||
            (SELECT clock_offset_ms FROM settings WHERE id = 1) AS mark`,
  );
  return String(rows[0]?.mark ?? "");
}

/** Records a webhook delivery; false if this event id was already handled. */
export async function recordWebhook({ id, eventType }, db = database()) {
  const { rowCount } = await db.query("INSERT INTO webhook_events (id, event_type) VALUES (?1, ?2) ON CONFLICT DO NOTHING", [id, eventType]);
  return rowCount === 1;
}

export async function bookingIdForAuthorization(authorizationId, db = database()) {
  const { rows } = await db.query("SELECT id FROM bookings WHERE authorization_id = ?1", [authorizationId]);
  return rows[0]?.id ?? null;
}

// One sweep at a time across Workers isolates: a lease row. A crashed sweep's lease expires on its own.
export async function takeSweepLease(now = new Date(), db = database()) {
  const { rowCount } = await db.query("UPDATE sweep_lock SET locked_until = ?1 WHERE id = 1 AND locked_until < ?2", [new Date(now.getTime() + 2 * 60_000), now]);
  return rowCount === 1;
}

export async function releaseSweepLease(db = database()) {
  await db.query("UPDATE sweep_lock SET locked_until = '1970-01-01T00:00:00.000Z' WHERE id = 1");
}
