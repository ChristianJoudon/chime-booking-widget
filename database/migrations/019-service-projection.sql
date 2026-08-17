-- Project administrator services into the table the customer widget reads.
--
-- The product is two applications over one database. The studio edits
-- chime_app.services; the widget offers whatever is in public.chime_services.
-- Nothing connected them, so an owner could rename a service, change its
-- length, change its deposit or unpublish it entirely, and customers would keep
-- being offered the old one indefinitely. Verified before writing this: the
-- studio reported "Quick check-in RENAMED / 45 min" while the widget still
-- offered "Quick check-in / 30 min".
--
-- It looked correct until something changed, because the demo seed inserts the
-- same UUIDs into both tables. Agreement by coincidence, not by construction.
--
-- Migration 005 already projects the other direction — a widget booking becomes
-- an appointment through an AFTER INSERT trigger. This is that pattern pointing
-- the other way, and deliberately so: one mechanism to understand rather than
-- two.
--
-- The link column and its unique index already existed, added by migration 004
-- and populated by the seed. Only the write was missing.

BEGIN;

/*
 * Keeps public.chime_services in step with one administrator service.
 *
 * Runs for INSERT, UPDATE and DELETE. Splitting them would mean three functions
 * agreeing on the same field mapping, which is how the mapping drifts.
 */
CREATE OR REPLACE FUNCTION chime_app.project_service_to_widget()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deposit_cents integer;
  v_offered boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.chime_services
     WHERE organization_id = OLD.organization_id
       AND admin_service_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Test and demo records exist so someone can try the product without
  -- touching the business. They must never reach a paying customer, so they
  -- are removed from the widget rather than projected into it.
  IF COALESCE(NEW.origin, 'business') <> 'business' THEN
    DELETE FROM public.chime_services
     WHERE organization_id = NEW.organization_id
       AND admin_service_id = NEW.id;
    RETURN NEW;
  END IF;

  -- The widget's query filters on `active`. In the studio a service reaches
  -- customers only when it is both active and public, so both flags collapse
  -- into the one the widget understands. Getting this wrong in either
  -- direction is visible to customers: a hidden service stays bookable, or a
  -- live one disappears.
  v_offered := NEW.is_active AND NEW.is_public;

  v_deposit_cents := CASE NEW.deposit_mode
    WHEN 'fixed' THEN COALESCE(NEW.deposit_amount_minor, 0)
    WHEN 'full' THEN COALESCE(NEW.price_minor, 0)
    -- Rounded to the cent the customer is actually charged, rather than
    -- carrying a fraction the payment provider would reject.
    WHEN 'percentage' THEN
      ROUND(COALESCE(NEW.price_minor, 0) * COALESCE(NEW.deposit_percentage, 0) / 100.0)::integer
    ELSE 0
  END;

  INSERT INTO public.chime_services (
    id, name, description, duration_minutes, deposit_amount_cents,
    active, sort_order, organization_id, admin_service_id
  )
  VALUES (
    NEW.id::text,
    NEW.name,
    NEW.short_description,
    NEW.default_duration_minutes,
    v_deposit_cents,
    v_offered,
    COALESCE((
      SELECT sort_order FROM public.chime_services
       WHERE organization_id = NEW.organization_id AND admin_service_id = NEW.id
    ), 0),
    NEW.organization_id,
    NEW.id
  )
  ON CONFLICT (organization_id, admin_service_id) WHERE organization_id IS NOT NULL AND admin_service_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    duration_minutes = EXCLUDED.duration_minutes,
    deposit_amount_cents = EXCLUDED.deposit_amount_cents,
    active = EXCLUDED.active,
    updated_at = now();

  RETURN NEW;
END $$;

COMMENT ON FUNCTION chime_app.project_service_to_widget() IS
  'Keeps public.chime_services in step with chime_app.services, so what the '
  'studio publishes is what customers are offered. Test-origin services are '
  'never projected.';

DROP TRIGGER IF EXISTS chime_project_service ON chime_app.services;
CREATE TRIGGER chime_project_service
  AFTER INSERT OR UPDATE OR DELETE ON chime_app.services
  FOR EACH ROW EXECUTE FUNCTION chime_app.project_service_to_widget();

-- Bring the widget into line with the studio for everything that already
-- exists, so the trigger is not the only thing that has ever agreed.
DO $$
DECLARE
  service chime_app.services%ROWTYPE;
BEGIN
  FOR service IN SELECT * FROM chime_app.services LOOP
    -- An UPDATE that changes nothing still fires the trigger, which does the
    -- projection. Repeating the mapping here would be a second copy to keep
    -- correct.
    UPDATE chime_app.services SET updated_at = updated_at WHERE id = service.id;
  END LOOP;
END $$;

COMMIT;
