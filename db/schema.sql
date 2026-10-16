-- HoldSlot schema. Applied by scripts/migrate.mjs before every start; safe to re-run.

CREATE TABLE IF NOT EXISTS settings (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name   text NOT NULL DEFAULT 'Juniper Hair Studio',
  time_zone       text NOT NULL DEFAULT 'America/New_York',
  currency        text NOT NULL DEFAULT 'USD',
  policy_text     text NOT NULL,
  rules           jsonb NOT NULL,
  clock_offset_ms bigint NOT NULL DEFAULT 0,  -- demo clock: added to the real time
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id    text PRIMARY KEY,
  name  text NOT NULL,
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  duration_min int NOT NULL CHECK (duration_min > 0),
  price        numeric(10,2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  visits        int NOT NULL DEFAULT 0,
  no_shows      int NOT NULL DEFAULT 0,
  late_cancels  int NOT NULL DEFAULT 0,
  vault_id      text,               -- PayPal payment token, capped by the approval text
  paypal_email  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id         text NOT NULL UNIQUE,
  client_id         uuid NOT NULL REFERENCES clients(id),
  service_id        text NOT NULL REFERENCES services(id),
  staff_id          text NOT NULL REFERENCES staff(id),
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  price             numeric(10,2) NOT NULL,
  status            text NOT NULL,
  risk_score        int NOT NULL,
  risk_tier         text NOT NULL,
  risk_reasons      text[] NOT NULL DEFAULT '{}',
  hold_amount       numeric(10,2) NOT NULL DEFAULT 0,
  order_id          text,
  authorization_id  text,
  hold_expires_at   timestamptz,
  capture_id        text,
  charged_amount    numeric(10,2) NOT NULL DEFAULT 0,
  checked_in_at     timestamptz,
  cancelled_at      timestamptz,
  source            text NOT NULL DEFAULT 'chat',
  booked_at         timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_open ON bookings (status, start_at);

CREATE TABLE IF NOT EXISTS pending_approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_token_id  text NOT NULL UNIQUE,
  nonce_hash      text NOT NULL,
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);

-- What the agent did and why, shown on the calendar and the client's booking page.
CREATE TABLE IF NOT EXISTS activity (
  id          bigserial PRIMARY KEY,
  booking_id  uuid REFERENCES bookings(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  kind        text NOT NULL,
  message     text NOT NULL,
  amount      numeric(10,2)
);
CREATE INDEX IF NOT EXISTS activity_recent ON activity (at DESC);

-- PayPal webhook deliveries already handled (PayPal retries).
CREATE TABLE IF NOT EXISTS webhook_events (
  id           text PRIMARY KEY,
  event_type   text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Lease so only one sweep runs at a time (see lib/server/ops.mjs).
CREATE TABLE IF NOT EXISTS sweep_lock (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  locked_until  timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO sweep_lock (id) VALUES (1) ON CONFLICT DO NOTHING;
