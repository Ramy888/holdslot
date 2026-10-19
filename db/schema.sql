-- HoldSlot schema for Cloudflare D1 (SQLite). Safe to re-run:
--   npm run db:migrate         (remote D1)
--   npm run db:migrate:local   (wrangler's local D1)
-- Times are ISO-8601 UTC strings ("2026-10-23T22:00:00.000Z"), so text order is time order.
-- Money is REAL dollars, rounded to cents by the app.

CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  business_name   TEXT NOT NULL DEFAULT 'Juniper Hair Studio',
  time_zone       TEXT NOT NULL DEFAULT 'America/New_York',
  currency        TEXT NOT NULL DEFAULT 'USD',
  policy_text     TEXT NOT NULL,
  rules           TEXT NOT NULL,              -- JSON, see lib/policy.mjs
  clock_offset_ms INTEGER NOT NULL DEFAULT 0, -- demo clock: added to the real time
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS staff (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price        REAL NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  visits        INTEGER NOT NULL DEFAULT 0,
  no_shows      INTEGER NOT NULL DEFAULT 0,
  late_cancels  INTEGER NOT NULL DEFAULT 0,
  vault_id      TEXT,               -- PayPal payment token, capped by the approval text
  paypal_email  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id                TEXT PRIMARY KEY,
  public_id         TEXT NOT NULL UNIQUE,
  client_id         TEXT NOT NULL REFERENCES clients(id),
  service_id        TEXT NOT NULL REFERENCES services(id),
  staff_id          TEXT NOT NULL REFERENCES staff(id),
  start_at          TEXT NOT NULL,
  end_at            TEXT NOT NULL,
  price             REAL NOT NULL,
  status            TEXT NOT NULL,
  risk_score        INTEGER NOT NULL,
  risk_tier         TEXT NOT NULL,
  risk_reasons      TEXT NOT NULL DEFAULT '[]', -- JSON array
  hold_amount       REAL NOT NULL DEFAULT 0,
  order_id          TEXT,
  authorization_id  TEXT,
  hold_expires_at   TEXT,
  capture_id        TEXT,
  charged_amount    REAL NOT NULL DEFAULT 0,
  checked_in_at     TEXT,
  cancelled_at      TEXT,
  source            TEXT NOT NULL DEFAULT 'chat',
  booked_at         TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS bookings_open ON bookings (status, start_at);
CREATE INDEX IF NOT EXISTS bookings_authorization ON bookings (authorization_id);

CREATE TABLE IF NOT EXISTS pending_approvals (
  id              TEXT PRIMARY KEY,
  setup_token_id  TEXT NOT NULL UNIQUE,
  nonce_hash      TEXT NOT NULL,
  booking_id      TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT
);
CREATE INDEX IF NOT EXISTS pending_nonce ON pending_approvals (nonce_hash);

-- What the agent did and why, shown on the calendar and the client's booking page.
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  amount      REAL
);
CREATE INDEX IF NOT EXISTS activity_booking ON activity (booking_id);

-- PayPal webhook deliveries already handled (PayPal retries).
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Lease so only one sweep runs at a time (see lib/server/ops.mjs).
CREATE TABLE IF NOT EXISTS sweep_lock (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  locked_until  TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);
INSERT OR IGNORE INTO sweep_lock (id) VALUES (1);

-- Fixed-window counters for the limits on paid AI calls and the login (see lib/server/limits.mjs).
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
