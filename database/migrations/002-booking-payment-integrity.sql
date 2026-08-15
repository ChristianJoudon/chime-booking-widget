-- Defense in depth for the legacy portable-widget booking tables.
-- The API still verifies Stripe or explicitly enabled demo payments before BEGIN.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS chime_booking_payment_intent_unique
  ON public.chime_bookings (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chime_enforce_booking_payment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_deposit INTEGER;
BEGIN
  SELECT deposit_amount_cents
    INTO expected_deposit
    FROM public.chime_services
   WHERE id = NEW.service_id
     AND active = true;

  IF expected_deposit IS NULL THEN
    RAISE EXCEPTION 'Booking service is missing or inactive.' USING ERRCODE = '23514';
  END IF;

  IF NEW.deposit_amount_cents <> expected_deposit THEN
    RAISE EXCEPTION 'Booking deposit must match the service deposit.' USING ERRCODE = '23514';
  END IF;

  IF expected_deposit > 0 AND NULLIF(btrim(NEW.payment_intent_id), '') IS NULL THEN
    RAISE EXCEPTION 'Paid bookings require a payment intent.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_booking_payment_integrity ON public.chime_bookings;
CREATE TRIGGER enforce_booking_payment_integrity
BEFORE INSERT OR UPDATE OF service_id, deposit_amount_cents, payment_intent_id
ON public.chime_bookings
FOR EACH ROW
EXECUTE FUNCTION public.chime_enforce_booking_payment_integrity();

COMMIT;
