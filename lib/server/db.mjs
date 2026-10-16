// Postgres pool (one per process) and the queries the app uses.
import pg from "pg";

export function pool() {
  const url = process.env.DATABASE_URL ?? "";
  // Render's external URL (local dev) needs TLS; its internal URL does not.
  const tls = /sslmode=require/.test(url);
  globalThis.__holdslotPool ??= new pg.Pool({
    connectionString: url.replace(/[?&]sslmode=require/, ""),
    max: 5,
    ssl: tls ? { rejectUnauthorized: false } : undefined,
  });
  return globalThis.__holdslotPool;
}

const num = (v) => (v == null ? null : Number(v));

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
    startAt: r.start_at,
    endAt: r.end_at,
    price: num(r.price),
    status: r.status,
    riskScore: r.risk_score,
    riskTier: r.risk_tier,
    riskReasons: r.risk_reasons,
    holdAmount: num(r.hold_amount),
    orderId: r.order_id,
    authorizationId: r.authorization_id,
    holdExpiresAt: r.hold_expires_at,
    captureId: r.capture_id,
    chargedAmount: num(r.charged_amount),
    checkedInAt: r.checked_in_at,
    cancelledAt: r.cancelled_at,
    source: r.source,
    bookedAt: r.booked_at,
  };

const BOOKING_SELECT = `
  SELECT b.*, c.name AS client_name, c.email AS client_email, c.vault_id, s.name AS service_name
  FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id`;

export async function getSettings(db = pool()) {
  const { rows } = await db.query("SELECT * FROM settings WHERE id = 1");
  const r = rows[0];
  if (!r) throw new Error("Settings missing: run the migration.");
  return {
    businessName: r.business_name,
    timeZone: r.time_zone,
    currency: r.currency,
    policyText: r.policy_text,
    rules: r.rules,
    clockOffsetMs: Number(r.clock_offset_ms),
  };
}

export async function saveSettings(patch, db = pool()) {
  const cols = { policyText: "policy_text", rules: "rules", clockOffsetMs: "clock_offset_ms", businessName: "business_name" };
  const keys = Object.keys(patch).filter((k) => cols[k]);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${cols[k]} = $${i + 1}`).join(", ");
  await db.query(`UPDATE settings SET ${sets}, updated_at = now() WHERE id = 1`, keys.map((k) => (k === "rules" ? JSON.stringify(patch[k]) : patch[k])));
}

export async function listStaff(db = pool()) {
  return (await db.query("SELECT id, name, color FROM staff ORDER BY id")).rows;
}

export async function listServices(db = pool()) {
  const { rows } = await db.query("SELECT id, name, duration_min, price FROM services ORDER BY price");
  return rows.map((r) => ({ id: r.id, name: r.name, durationMin: r.duration_min, price: Number(r.price) }));
}

export async function listBookings({ from, to }, db = pool()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.end_at >= $1 AND b.start_at <= $2 ORDER BY b.start_at`, [from, to]);
  return rows.map(toBooking);
}

export async function openBookings(db = pool()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.status IN ('awaiting_approval','booked','held','hold_failed') ORDER BY b.start_at`);
  return rows.map(toBooking);
}

export async function getBooking(id, db = pool()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return toBooking(rows[0]);
}

export async function getBookingByPublicId(publicId, db = pool()) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.public_id = $1`, [publicId]);
  return toBooking(rows[0]);
}

/** Bookings that overlap [start, end) on a staff member, ignoring finished or cancelled ones. */
export async function busyFor({ staffId, from, to }, db = pool()) {
  const { rows } = await db.query(
    `SELECT staff_id, start_at, end_at FROM bookings
     WHERE status IN ('awaiting_approval','booked','held','hold_failed','released','charged','no_show')
       AND start_at < $2 AND end_at > $1 AND ($3::text IS NULL OR staff_id = $3)`,
    [from, to, staffId ?? null],
  );
  return rows.map((r) => ({ staffId: r.staff_id, startAt: r.start_at, endAt: r.end_at }));
}

export async function upsertClient({ name, email }, db = pool()) {
  const { rows } = await db.query(
    `INSERT INTO clients (name, email) VALUES ($1, lower($2))
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), clients.name)
     RETURNING id, name, email, visits, no_shows, late_cancels, vault_id`,
    [name, email],
  );
  const r = rows[0];
  return { id: r.id, name: r.name, email: r.email, visits: r.visits, noShows: r.no_shows, lateCancels: r.late_cancels, vaultId: r.vault_id };
}

export async function insertBooking(b, db = pool()) {
  const { rows } = await db.query(
    `INSERT INTO bookings (public_id, client_id, service_id, staff_id, start_at, end_at, price, status,
       risk_score, risk_tier, risk_reasons, hold_amount, source, booked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [b.publicId, b.clientId, b.serviceId, b.staffId, b.startAt, b.endAt, b.price, b.status, b.riskScore, b.riskTier, b.riskReasons, b.holdAmount, b.source, b.bookedAt],
  );
  return rows[0].id;
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
export async function transitionBooking(id, fromStatuses, patch, db = pool()) {
  const keys = Object.keys(patch).filter((k) => BOOKING_COLS[k]);
  const sets = keys.map((k, i) => `${BOOKING_COLS[k]} = $${i + 3}`).join(", ");
  const { rowCount } = await db.query(
    `UPDATE bookings SET ${sets}${sets ? ", " : ""}updated_at = now() WHERE id = $1 AND status = ANY($2)`,
    [id, fromStatuses, ...keys.map((k) => patch[k])],
  );
  return rowCount === 1;
}

export async function bumpClient(clientId, field, db = pool()) {
  const col = { visits: "visits", noShows: "no_shows", lateCancels: "late_cancels" }[field];
  await db.query(`UPDATE clients SET ${col} = ${col} + 1 WHERE id = $1`, [clientId]);
}

export async function setClientVault(clientId, { vaultId, paypalEmail }, db = pool()) {
  await db.query("UPDATE clients SET vault_id = $2, paypal_email = $3 WHERE id = $1", [clientId, vaultId, paypalEmail]);
}

export async function logActivity({ bookingId, at, kind, message, amount = null }, db = pool()) {
  await db.query("INSERT INTO activity (booking_id, at, kind, message, amount) VALUES ($1,$2,$3,$4,$5)", [bookingId, at, kind, message, amount]);
}

export async function recentActivity(limit = 30, db = pool()) {
  const { rows } = await db.query(
    `SELECT a.id, a.booking_id, a.at, a.kind, a.message, a.amount, c.name AS client_name
     FROM activity a LEFT JOIN bookings b ON b.id = a.booking_id LEFT JOIN clients c ON c.id = b.client_id
     ORDER BY a.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), bookingId: r.booking_id, at: r.at, kind: r.kind, message: r.message, amount: num(r.amount), clientName: r.client_name }));
}

export async function bookingActivity(bookingId, db = pool()) {
  const { rows } = await db.query("SELECT at, kind, message, amount FROM activity WHERE booking_id = $1 ORDER BY id", [bookingId]);
  return rows.map((r) => ({ at: r.at, kind: r.kind, message: r.message, amount: num(r.amount) }));
}

export async function insertPending({ setupTokenId, nonceHash, bookingId, expiresAt }, db = pool()) {
  await db.query("INSERT INTO pending_approvals (setup_token_id, nonce_hash, booking_id, expires_at) VALUES ($1,$2,$3,$4)", [setupTokenId, nonceHash, bookingId, expiresAt]);
}

export async function findPending(nonceHash, db = pool()) {
  const { rows } = await db.query("SELECT * FROM pending_approvals WHERE nonce_hash = $1", [nonceHash]);
  const r = rows[0];
  return r && { id: r.id, setupTokenId: r.setup_token_id, bookingId: r.booking_id, expiresAt: r.expires_at, usedAt: r.used_at };
}

/** Marks the approval used; false if another request already did (double-clicked return link). */
export async function markPendingUsed(id, db = pool()) {
  const { rowCount } = await db.query("UPDATE pending_approvals SET used_at = now() WHERE id = $1 AND used_at IS NULL", [id]);
  return rowCount === 1;
}
