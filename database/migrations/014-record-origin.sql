-- Separate business records from demo and automated-test records.
--
-- Smoke runs write real rows into the same tables a business uses, so
-- "Smoke service 1786779379821 updated" sits in the service directory beside
-- the four real services, and test customers appear beside real ones. The
-- tightening plan asks that test-generated records be tagged and hidden from
-- ordinary business views by default.
--
--   business  a real record belonging to the business (default)
--   demo      seeded showcase data for an evaluation workspace
--   test      created by an automated smoke run; hidden unless asked for
--
-- Additive and idempotent. Existing rows default to 'business', then the
-- backfills below reclassify what is recognizably demo or test.

BEGIN;

ALTER TABLE chime_app.services
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'business';
ALTER TABLE chime_app.customers
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'business';
ALTER TABLE chime_app.appointments
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'business';

ALTER TABLE chime_app.services DROP CONSTRAINT IF EXISTS services_origin_check;
ALTER TABLE chime_app.services
  ADD CONSTRAINT services_origin_check CHECK (origin IN ('business', 'demo', 'test'));
ALTER TABLE chime_app.customers DROP CONSTRAINT IF EXISTS customers_origin_check;
ALTER TABLE chime_app.customers
  ADD CONSTRAINT customers_origin_check CHECK (origin IN ('business', 'demo', 'test'));
ALTER TABLE chime_app.appointments DROP CONSTRAINT IF EXISTS appointments_origin_check;
ALTER TABLE chime_app.appointments
  ADD CONSTRAINT appointments_origin_check CHECK (origin IN ('business', 'demo', 'test'));

-- Ordinary listings filter on origin, so index the common path.
CREATE INDEX IF NOT EXISTS services_business_origin_idx
  ON chime_app.services (organization_id, origin);
CREATE INDEX IF NOT EXISTS customers_business_origin_idx
  ON chime_app.customers (organization_id, origin);
CREATE INDEX IF NOT EXISTS appointments_business_origin_idx
  ON chime_app.appointments (organization_id, origin);

-- Backfill: smoke runs name their services predictably.
UPDATE chime_app.services
   SET origin = 'test'
 WHERE origin = 'business'
   AND name LIKE 'Smoke service %';

-- Backfill: automated runs address the reserved .invalid TLD with a
-- recognizable local part.
UPDATE chime_app.customers
   SET origin = 'test'
 WHERE origin = 'business'
   AND (email LIKE 'payment-safety-%@example.invalid'
        OR email LIKE 'smoke-%@example.invalid'
        OR email LIKE '%-smoke@example.invalid'
        OR email = 'booking-projection-smoke@example.invalid');

-- Backfill: the seeded showcase business.
UPDATE chime_app.customers
   SET origin = 'demo'
 WHERE origin = 'business'
   AND metadata ->> 'demoProfile' = 'true';

UPDATE chime_app.appointments
   SET origin = 'demo'
 WHERE origin = 'business'
   AND custom_answers ->> 'seed' = 'schedule-showcase';

UPDATE chime_app.appointments appointment
   SET origin = 'test'
 WHERE appointment.origin <> 'test'
   AND EXISTS (
     SELECT 1 FROM chime_app.customers customer
      WHERE customer.id = appointment.customer_id
        AND customer.origin = 'test'
   );

-- A smoke run left its own identity in the demo customers' metadata, which is
-- residue rather than a tag. Drop the keys it wrote; keep everything else.
UPDATE chime_app.customers
   SET metadata = metadata - 'name' - 'email'
 WHERE origin = 'demo'
   AND metadata ->> 'name' = 'Payment Safety Test';

COMMIT;
