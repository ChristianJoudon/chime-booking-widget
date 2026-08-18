-- A record of every Stripe event this server has processed.
--
-- Stripe retries a webhook until it gets a 2xx, and can deliver the same event
-- more than once even after success. Without a record of what has already been
-- handled, a retry of payment_intent.succeeded would reconcile a payment twice.
-- The primary key is Stripe's own event id, so a replay is a conflict rather
-- than a second application.
--
-- Kept as a table rather than an in-memory set because retries can arrive days
-- apart, and across a restart or a second container an in-memory set is empty.

BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.stripe_webhook_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  payment_intent_id text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  handled_at   timestamptz,
  outcome      text,
  detail       text
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_intent
  ON chime_app.stripe_webhook_events (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

COMMENT ON TABLE chime_app.stripe_webhook_events IS
  'One row per Stripe event id. Makes webhook delivery idempotent across '
  'retries, restarts and multiple containers.';

/*
 * Money taken with no appointment behind it.
 *
 * A customer can pay at Stripe and then lose their connection before the
 * booking request reaches this server. Stripe has the money; Chime has a hold
 * and no booking. Nothing surfaced that today — the business would find out
 * when somebody arrived for an appointment that does not exist.
 *
 * The webhook writes here when it sees a succeeded intent whose hold has no
 * booking, so there is somewhere to look.
 */
ALTER TABLE public.chime_payment_holds
  ADD COLUMN IF NOT EXISTS needs_attention_reason text,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

CREATE INDEX IF NOT EXISTS chime_payment_holds_needs_attention
  ON public.chime_payment_holds (flagged_at)
  WHERE needs_attention_reason IS NOT NULL;

COMMIT;
