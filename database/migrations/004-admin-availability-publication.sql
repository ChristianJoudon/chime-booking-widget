BEGIN;

ALTER TABLE public.chime_services
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS admin_service_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS chime_services_admin_service_unique
  ON public.chime_services (organization_id, admin_service_id)
  WHERE organization_id IS NOT NULL AND admin_service_id IS NOT NULL;

ALTER TABLE public.chime_availability_slots
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS publication_id UUID,
  ADD COLUMN IF NOT EXISTS generation_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS chime_availability_generation_key_unique
  ON public.chime_availability_slots (generation_key)
  WHERE generation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS chime_availability_org_window
  ON public.chime_availability_slots (organization_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS chime_app.availability_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  horizon_days INTEGER NOT NULL CHECK (horizon_days BETWEEN 7 AND 90),
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'published', 'failed')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,
  request_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  CHECK (starts_on <= ends_on)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chime_slots_publication_fk'
       AND conrelid = 'public.chime_availability_slots'::regclass
  ) THEN
    ALTER TABLE public.chime_availability_slots
      ADD CONSTRAINT chime_slots_publication_fk
      FOREIGN KEY (publication_id)
      REFERENCES chime_app.availability_publications(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.chime_slot_candidates (
  slot_id UUID NOT NULL REFERENCES public.chime_availability_slots(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES public.chime_services(id) ON DELETE CASCADE,
  staff_member_id UUID NOT NULL REFERENCES chime_app.staff_members(id) ON DELETE CASCADE,
  location_id UUID REFERENCES chime_app.locations(id) ON DELETE SET NULL,
  busy_starts_at TIMESTAMPTZ NOT NULL,
  busy_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, staff_member_id),
  CHECK (busy_starts_at < busy_ends_at)
);

CREATE INDEX IF NOT EXISTS chime_slot_candidates_staff_window
  ON public.chime_slot_candidates (organization_id, staff_member_id, busy_starts_at, busy_ends_at);

CREATE TABLE IF NOT EXISTS public.chime_booking_assignments (
  booking_id UUID PRIMARY KEY REFERENCES public.chime_bookings(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.chime_availability_slots(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  staff_member_id UUID NOT NULL REFERENCES chime_app.staff_members(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES chime_app.locations(id) ON DELETE SET NULL,
  busy_starts_at TIMESTAMPTZ NOT NULL,
  busy_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (busy_starts_at < busy_ends_at)
);

CREATE INDEX IF NOT EXISTS chime_booking_assignments_staff_window
  ON public.chime_booking_assignments (organization_id, staff_member_id, busy_starts_at, busy_ends_at);

CREATE OR REPLACE FUNCTION public.chime_refresh_generated_slot_capacities(target_organization UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  WITH refreshed AS (
    SELECT s.id,
           s.booked_count,
           COUNT(c.staff_member_id) FILTER (
             WHERE NOT EXISTS (
               SELECT 1
                 FROM public.chime_booking_assignments a
                WHERE a.organization_id = c.organization_id
                  AND a.staff_member_id = c.staff_member_id
                  AND a.busy_starts_at < c.busy_ends_at
                  AND a.busy_ends_at > c.busy_starts_at
             )
           )::INTEGER AS free_candidates
      FROM public.chime_availability_slots s
      LEFT JOIN public.chime_slot_candidates c ON c.slot_id = s.id
     WHERE s.organization_id = target_organization
       AND s.source = 'admin'
       AND s.starts_at >= now()
     GROUP BY s.id, s.booked_count
  )
  UPDATE public.chime_availability_slots s
     SET capacity = GREATEST(r.booked_count, r.booked_count + r.free_candidates),
         status = CASE WHEN r.free_candidates > 0 THEN 'available' ELSE 'booked' END,
         updated_at = now()
    FROM refreshed r
   WHERE s.id = r.id;
$$;

CREATE OR REPLACE FUNCTION public.chime_assign_booking_candidate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  candidate public.chime_slot_candidates%ROWTYPE;
  candidate_count INTEGER;
  slot_organization UUID;
BEGIN
  SELECT organization_id INTO slot_organization
    FROM public.chime_availability_slots
   WHERE id = NEW.slot_id;

  SELECT COUNT(*) INTO candidate_count
    FROM public.chime_slot_candidates
   WHERE slot_id = NEW.slot_id;

  IF candidate_count = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('chime-staff-booking:' || slot_organization::TEXT, 0));

  SELECT c.* INTO candidate
    FROM public.chime_slot_candidates c
   WHERE c.slot_id = NEW.slot_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.chime_booking_assignments a
        WHERE a.organization_id = c.organization_id
          AND a.staff_member_id = c.staff_member_id
          AND a.busy_starts_at < c.busy_ends_at
          AND a.busy_ends_at > c.busy_starts_at
     )
   ORDER BY c.staff_member_id
   LIMIT 1;

  IF candidate.staff_member_id IS NULL THEN
    RAISE EXCEPTION 'CHIME_NO_STAFF_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.chime_booking_assignments (
    booking_id, slot_id, organization_id, staff_member_id, location_id,
    busy_starts_at, busy_ends_at
  ) VALUES (
    NEW.id, NEW.slot_id, candidate.organization_id, candidate.staff_member_id,
    candidate.location_id, candidate.busy_starts_at, candidate.busy_ends_at
  );

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chime_assign_booking_candidate_trigger ON public.chime_bookings;
CREATE TRIGGER chime_assign_booking_candidate_trigger
AFTER INSERT ON public.chime_bookings
FOR EACH ROW EXECUTE FUNCTION public.chime_assign_booking_candidate();

CREATE OR REPLACE FUNCTION public.chime_refresh_slots_after_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_organization UUID;
BEGIN
  target_organization := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  PERFORM public.chime_refresh_generated_slot_capacities(target_organization);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chime_refresh_slots_assignment_insert ON public.chime_booking_assignments;
CREATE TRIGGER chime_refresh_slots_assignment_insert
AFTER INSERT ON public.chime_booking_assignments
FOR EACH ROW EXECUTE FUNCTION public.chime_refresh_slots_after_assignment();

DROP TRIGGER IF EXISTS chime_refresh_slots_assignment_delete ON public.chime_booking_assignments;
CREATE TRIGGER chime_refresh_slots_assignment_delete
AFTER DELETE ON public.chime_booking_assignments
FOR EACH ROW EXECUTE FUNCTION public.chime_refresh_slots_after_assignment();

CREATE OR REPLACE FUNCTION public.chime_refresh_slots_after_booking_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL AND NEW.source = 'admin' THEN
    PERFORM public.chime_refresh_generated_slot_capacities(NEW.organization_id);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chime_refresh_slots_booking_count_update ON public.chime_availability_slots;
CREATE TRIGGER chime_refresh_slots_booking_count_update
AFTER UPDATE OF booked_count ON public.chime_availability_slots
FOR EACH ROW
WHEN (OLD.booked_count IS DISTINCT FROM NEW.booked_count)
EXECUTE FUNCTION public.chime_refresh_slots_after_booking_count();

CREATE OR REPLACE FUNCTION public.chime_release_cancelled_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'canceled', 'declined') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.chime_booking_assignments WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chime_release_cancelled_assignment_trigger ON public.chime_bookings;
CREATE TRIGGER chime_release_cancelled_assignment_trigger
AFTER UPDATE OF status ON public.chime_bookings
FOR EACH ROW EXECUTE FUNCTION public.chime_release_cancelled_assignment();

COMMIT;
