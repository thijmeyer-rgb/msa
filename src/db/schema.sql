-- ═══════════════════════════════════════════════════════════════════════
--  Muziekstudio Alkmaar — databaseschema
--  Idempotent: veilig meerdere keren uit te voeren (db:migrate).
--  gen_random_uuid() zit in de Postgres-core sinds PG13 (geen extensie nodig).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Klanten ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT NOT NULL,
  -- Uren-tegoed in MINUTEN (fase 2: urenpakketten). Standaard 0.
  credit_minutes INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eén klantrecord per e-mailadres (case-insensitive) hergebruiken.
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_idx
  ON customers (lower(email));

-- ─── Boekingen ────────────────────────────────────────────────────────────
-- status:
--   pending  = slot gereserveerd, wacht op betaling (houdt slot vast)
--   paid     = betaald en definitief (houdt slot vast)
--   failed   = betaling mislukt (slot vrij)
--   expired  = klant betaalde niet op tijd (slot vrij)
--   canceled = geannuleerd (slot vrij)
CREATE TABLE IF NOT EXISTS bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date      DATE NOT NULL,
  daypart           TEXT NOT NULL
                      CHECK (daypart IN ('ochtend','middag','avond','latenight')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','expired','canceled')),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  price_cents       INTEGER NOT NULL,
  num_people        INTEGER,                 -- aantal personen (boekingsveld)
  notes             TEXT,                    -- toekomstig vrij veld
  -- Fase 2: als de boeking met uren-tegoed is betaald i.p.v. Mollie.
  paid_with_credit  BOOLEAN NOT NULL DEFAULT false,
  credit_minutes_used INTEGER NOT NULL DEFAULT 0,
  -- Mollie
  mollie_payment_id TEXT,
  -- Fase 3: gekoppeld Google Calendar event.
  google_event_id   TEXT,
  -- Wanneer een 'pending' boeking verloopt en het slot weer vrijkomt.
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ★ KERN VAN DE DUBBELE-BOEKING-BESCHERMING ★
-- Er kan hooguit ÉÉN actieve boeking (pending of paid) per slot bestaan.
-- Twee gelijktijdige inserts voor hetzelfde slot: de database laat er maar
-- één toe, de tweede krijgt een unieke-sleutel-fout. Dit is een garantie op
-- databaseniveau, niet slechts een check-then-write in applicatiecode.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_idx
  ON bookings (booking_date, daypart)
  WHERE status IN ('pending','paid');

CREATE INDEX IF NOT EXISTS bookings_mollie_idx ON bookings (mollie_payment_id);
CREATE INDEX IF NOT EXISTS bookings_expiry_idx ON bookings (expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_id);

-- ─── Blokkades ────────────────────────────────────────────────────────────
-- Handmatige blokkades (admin) + geïmporteerde Google Calendar-blokkades (fase 3).
-- daypart NULL = de hele dag geblokkeerd.
CREATE TABLE IF NOT EXISTS blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date      DATE NOT NULL,
  daypart         TEXT
                    CHECK (daypart IS NULL OR daypart IN ('ochtend','middag','avond','latenight')),
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','google')),
  google_event_id TEXT,                       -- fase 3: herkomst-event
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blocks_date_idx ON blocks (block_date);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_google_event_idx
  ON blocks (google_event_id) WHERE google_event_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
--  FASE 2 — urenpakketten (prepaid credits) + klantaccounts
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Credit-batches ───────────────────────────────────────────────────────
-- Elke aankoop (of handmatige toekenning door de admin) is één batch met een
-- eigen vervaldatum. Het saldo van een klant = som van minutes_remaining over
-- niet-verlopen batches. Verbruik gaat FIFO op vervaldatum (eerst-vervallend).
CREATE TABLE IF NOT EXISTS credit_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  minutes_total     INTEGER NOT NULL,
  minutes_remaining INTEGER NOT NULL CHECK (minutes_remaining >= 0),
  expires_at        TIMESTAMPTZ,               -- NULL = verloopt nooit
  source            TEXT NOT NULL DEFAULT 'purchase'
                      CHECK (source IN ('purchase','admin','refund')),
  package_key       TEXT,                       -- welk pakket (bij aankoop)
  mollie_payment_id TEXT,
  note              TEXT,                       -- reden (bij admin-toekenning)
  created_by        TEXT,                       -- 'system' of 'admin'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_batches_customer_idx
  ON credit_batches (customer_id, expires_at);

-- ─── Pakket-orders ────────────────────────────────────────────────────────
-- Een aankoop-in-uitvoering. De credit-batch wordt pas aangemaakt zodra de
-- betaling 'paid' is (via de webhook), idempotent op mollie_payment_id.
CREATE TABLE IF NOT EXISTS package_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  package_key       TEXT NOT NULL,
  minutes           INTEGER NOT NULL,
  price_cents       INTEGER NOT NULL,
  validity_days     INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','expired','canceled')),
  mollie_payment_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS package_orders_mollie_idx ON package_orders (mollie_payment_id);
CREATE INDEX IF NOT EXISTS package_orders_customer_idx ON package_orders (customer_id);

-- ─── Login-tokens (magic link) ────────────────────────────────────────────
-- Wachtwoordloze login: we mailen een eenmalige link. Alleen de hash van het
-- token wordt bewaard.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens (email);
