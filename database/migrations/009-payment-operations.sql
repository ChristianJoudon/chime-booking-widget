BEGIN;

ALTER TABLE chime_app.payments
  ADD COLUMN IF NOT EXISTS captured_amount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS payment_method_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE chime_app.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE chime_app.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'requires_payment', 'processing', 'authorized', 'succeeded', 'failed',
    'partially_refunded', 'refunded', 'cancelled'
  ));

DO $$
BEGIN
  ALTER TABLE chime_app.payments
    ADD CONSTRAINT payments_amount_progress_check
    CHECK (
      captured_amount_minor >= 0
      AND captured_amount_minor <= amount_minor
      AND refunded_amount_minor >= 0
      AND refunded_amount_minor <= captured_amount_minor
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE chime_app.payments
    ADD CONSTRAINT payments_version_check CHECK (version > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS chime_app.payment_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES chime_app.payments(id) ON DELETE CASCADE,
  initiated_by_user_id uuid REFERENCES chime_app.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('capture', 'void', 'refund', 'sync')),
  amount_minor integer NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'succeeded', 'failed')),
  reason text,
  provider_operation_id text,
  error_message text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_actions_history_idx
  ON chime_app.payment_actions (organization_id, payment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_operations_attention_idx
  ON chime_app.payments (organization_id, status, updated_at DESC);

UPDATE chime_app.payments
SET captured_amount_minor = CASE
      WHEN status IN ('succeeded', 'partially_refunded', 'refunded') THEN amount_minor
      ELSE captured_amount_minor
    END,
    refunded_amount_minor = CASE
      WHEN status = 'refunded' THEN amount_minor
      ELSE refunded_amount_minor
    END;

INSERT INTO chime_app.payments (
  organization_id,
  appointment_id,
  provider,
  provider_payment_id,
  amount_minor,
  captured_amount_minor,
  refunded_amount_minor,
  currency,
  status,
  verified_at,
  metadata,
  last_provider_sync_at
)
SELECT
  link.organization_id,
  link.appointment_id,
  CASE WHEN payment.payment_intent_id LIKE 'demo_pi_%' THEN 'demo' ELSE 'stripe' END,
  payment.payment_intent_id,
  payment.amount_cents,
  CASE WHEN payment.status IN ('captured', 'demo', 'succeeded', 'refunded') THEN payment.amount_cents ELSE 0 END,
  CASE WHEN payment.status = 'refunded' THEN payment.amount_cents ELSE 0 END,
  upper(payment.currency),
  CASE payment.status
    WHEN 'authorized' THEN 'authorized'
    WHEN 'captured' THEN 'succeeded'
    WHEN 'demo' THEN 'succeeded'
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'partially_refunded' THEN 'partially_refunded'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'failed' THEN 'failed'
    ELSE 'processing'
  END,
  CASE WHEN payment.status IN ('authorized', 'captured', 'demo', 'succeeded', 'refunded') THEN payment.updated_at ELSE NULL END,
  jsonb_build_object('source', 'portable_widget', 'widgetBookingId', payment.booking_id),
  payment.updated_at
FROM public.chime_payment_holds payment
JOIN chime_app.widget_booking_links link ON link.widget_booking_id = payment.booking_id
WHERE payment.payment_intent_id IS NOT NULL
ON CONFLICT (provider, provider_payment_id) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    captured_amount_minor = EXCLUDED.captured_amount_minor,
    refunded_amount_minor = EXCLUDED.refunded_amount_minor,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    verified_at = COALESCE(EXCLUDED.verified_at, chime_app.payments.verified_at),
    metadata = chime_app.payments.metadata || EXCLUDED.metadata,
    last_provider_sync_at = EXCLUDED.last_provider_sync_at,
    version = chime_app.payments.version + 1,
    updated_at = now();

CREATE OR REPLACE FUNCTION chime_app.sync_widget_payment_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
DECLARE
  linked record;
  mapped_provider text;
  mapped_status text;
  mapped_captured integer;
  mapped_refunded integer;
BEGIN
  IF NEW.booking_id IS NULL OR NEW.payment_intent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT link.organization_id, link.appointment_id
  INTO linked
  FROM chime_app.widget_booking_links link
  WHERE link.widget_booking_id = NEW.booking_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  mapped_provider := CASE WHEN NEW.payment_intent_id LIKE 'demo_pi_%' THEN 'demo' ELSE 'stripe' END;
  mapped_status := CASE NEW.status
    WHEN 'authorized' THEN 'authorized'
    WHEN 'captured' THEN 'succeeded'
    WHEN 'demo' THEN 'succeeded'
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'processing'
  END;
  mapped_captured := CASE WHEN NEW.status IN ('captured', 'demo', 'succeeded', 'partially_refunded', 'refunded') THEN NEW.amount_cents ELSE 0 END;
  mapped_refunded := CASE
    WHEN NEW.status = 'refunded' THEN NEW.amount_cents
    WHEN NEW.status = 'partially_refunded' THEN COALESCE((
      SELECT existing.refunded_amount_minor
      FROM chime_app.payments existing
      WHERE existing.provider = mapped_provider
        AND existing.provider_payment_id = NEW.payment_intent_id
    ), 0)
    ELSE 0
  END;

  INSERT INTO chime_app.payments (
    organization_id, appointment_id, provider, provider_payment_id,
    amount_minor, captured_amount_minor, refunded_amount_minor,
    currency, status, verified_at, metadata, last_provider_sync_at
  ) VALUES (
    linked.organization_id,
    linked.appointment_id,
    mapped_provider,
    NEW.payment_intent_id,
    NEW.amount_cents,
    mapped_captured,
    mapped_refunded,
    upper(NEW.currency),
    mapped_status,
    CASE WHEN mapped_status IN ('authorized', 'succeeded', 'refunded') THEN NEW.updated_at ELSE NULL END,
    jsonb_build_object('source', 'portable_widget', 'widgetBookingId', NEW.booking_id),
    NEW.updated_at
  )
  ON CONFLICT (provider, provider_payment_id) DO UPDATE
  SET appointment_id = EXCLUDED.appointment_id,
      amount_minor = EXCLUDED.amount_minor,
      captured_amount_minor = EXCLUDED.captured_amount_minor,
      refunded_amount_minor = EXCLUDED.refunded_amount_minor,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      verified_at = COALESCE(EXCLUDED.verified_at, chime_app.payments.verified_at),
      metadata = chime_app.payments.metadata || EXCLUDED.metadata,
      last_provider_sync_at = EXCLUDED.last_provider_sync_at,
      version = chime_app.payments.version + 1,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_chime_sync_widget_payment_hold ON public.chime_payment_holds;
CREATE TRIGGER zz_chime_sync_widget_payment_hold
AFTER INSERT OR UPDATE OF booking_id, payment_intent_id, amount_cents, currency, status
ON public.chime_payment_holds
FOR EACH ROW EXECUTE FUNCTION chime_app.sync_widget_payment_hold();

COMMIT;
