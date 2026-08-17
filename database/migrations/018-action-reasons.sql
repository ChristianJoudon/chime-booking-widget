-- Require a reason on the actions that take money back or stop a message.
--
-- payment_actions already recorded who and when, but reason was nullable and
-- the API accepted an empty string, so a refund could be recorded with no
-- explanation of why. Suppressing a delivery recorded nothing at all: the row
-- simply changed status, with no trace of who stopped it or why.
--
-- These are the actions someone asks about months later — a customer disputes
-- a refund, or asks why they never received a confirmation. "Administrator,
-- reason, and timestamp" is only useful if the reason cannot be skipped.

BEGIN;

-- Existing rows predate the requirement, so they are backfilled rather than
-- blocking the constraint. Saying so explicitly is better than inventing a
-- plausible reason for something nobody recorded.
UPDATE chime_app.payment_actions
   SET reason = 'Recorded before reasons were required'
 WHERE reason IS NULL OR btrim(reason) = '';

ALTER TABLE chime_app.payment_actions
  ALTER COLUMN reason SET NOT NULL;

ALTER TABLE chime_app.payment_actions DROP CONSTRAINT IF EXISTS payment_actions_reason_present;
ALTER TABLE chime_app.payment_actions
  ADD CONSTRAINT payment_actions_reason_present
  CHECK (
    -- capture and sync move no money away from the business and need no
    -- justification; refund and void do.
    action IN ('capture', 'sync') OR length(btrim(reason)) >= 3
  );

-- Suppression stops a customer from receiving something they were meant to
-- receive, so it records who and why alongside the status change.
ALTER TABLE chime_app.notification_deliveries
  ADD COLUMN IF NOT EXISTS suppressed_reason text;
ALTER TABLE chime_app.notification_deliveries
  ADD COLUMN IF NOT EXISTS suppressed_by_user_id uuid REFERENCES chime_app.users(id);
ALTER TABLE chime_app.notification_deliveries
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;

ALTER TABLE chime_app.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_suppression_explained;
ALTER TABLE chime_app.notification_deliveries
  ADD CONSTRAINT notification_deliveries_suppression_explained
  CHECK (status <> 'suppressed' OR suppressed_reason IS NOT NULL);

-- Anything already suppressed predates the column.
UPDATE chime_app.notification_deliveries
   SET suppressed_reason = 'Recorded before reasons were required',
       suppressed_at = COALESCE(suppressed_at, updated_at)
 WHERE status = 'suppressed' AND suppressed_reason IS NULL;

COMMIT;
