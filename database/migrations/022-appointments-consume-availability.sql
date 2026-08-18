-- Appointments made in the studio take the time off the widget.
--
-- The widget's availability is already staff-aware: for each published slot,
-- chime_refresh_generated_slot_capacities counts the team members who could
-- take it and are not busy, and marks the slot booked when none are. What it
-- called "busy" was only ever public.chime_booking_assignments — the record a
-- widget booking leaves behind.
--
-- So a team member could be booked solid in the studio and the widget would
-- keep offering their time, because the studio's appointments were invisible to
-- the one query that decides what customers see. Nothing a customer did could
-- cause it — until now nothing could create an appointment except the widget
-- itself, which always leaves an assignment row. It becomes reachable the
-- moment an administrator can enter a booking taken over the phone, and it is
-- already visible in the practice data, where the seeded week is written
-- straight into the administrator's tables.
--
-- One clause fixes both: an appointment counts as busy too.
--
-- Buffers are included on this side because the studio's own conflict check
-- includes them (findScheduleConflicts in operationsRoutes.ts). Without them
-- the widget would offer a time that the studio then refused to move anyone
-- into — two answers to one question about the same hour.

BEGIN;

CREATE OR REPLACE FUNCTION public.chime_refresh_generated_slot_capacities(
  target_organization uuid
)
RETURNS void
LANGUAGE sql
AS $$
  WITH busy_appointments AS (
    SELECT
      assigned.staff_member_id,
      appointment.organization_id,
      appointment.starts_at
        - make_interval(mins => COALESCE(service.buffer_before_minutes, 0)) AS busy_from,
      appointment.ends_at
        + make_interval(mins => COALESCE(service.buffer_after_minutes, 0)) AS busy_to
    FROM chime_app.appointment_staff assigned
    JOIN chime_app.appointments appointment
      ON appointment.id = assigned.appointment_id
    LEFT JOIN chime_app.services service
      ON service.id = appointment.service_id
    WHERE appointment.organization_id = target_organization
      AND assigned.role = 'assigned'
      -- The same three the studio's conflict check treats as occupying time.
      -- Cancelled and completed appointments free their slot; a request pending
      -- a decision does not, because the original time is still held.
      AND appointment.status IN ('pending_approval', 'confirmed', 'change_pending')
      AND appointment.ends_at >= now()
  ),
  refreshed AS (
    SELECT
      slot.id,
      slot.booked_count,
      COUNT(candidate.staff_member_id) FILTER (
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.chime_booking_assignments assignment
          WHERE assignment.organization_id = candidate.organization_id
            AND assignment.staff_member_id = candidate.staff_member_id
            AND assignment.busy_starts_at < candidate.busy_ends_at
            AND assignment.busy_ends_at > candidate.busy_starts_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM busy_appointments busy
          WHERE busy.organization_id = candidate.organization_id
            AND busy.staff_member_id = candidate.staff_member_id
            AND busy.busy_from < candidate.busy_ends_at
            AND busy.busy_to > candidate.busy_starts_at
        )
      )::integer AS free_candidates
    FROM public.chime_availability_slots slot
    LEFT JOIN public.chime_slot_candidates candidate ON candidate.slot_id = slot.id
    WHERE slot.organization_id = target_organization
      AND slot.source = 'admin'
      AND slot.starts_at >= now()
    GROUP BY slot.id, slot.booked_count
  )
  UPDATE public.chime_availability_slots slot
  SET capacity = GREATEST(1, refreshed.booked_count, refreshed.booked_count + refreshed.free_candidates),
      status = CASE WHEN refreshed.free_candidates > 0 THEN 'available' ELSE 'booked' END,
      updated_at = now()
  FROM refreshed
  WHERE slot.id = refreshed.id;
$$;

/*
 * A widget booking already recomputes capacity, through the assignment row it
 * writes. An appointment created in the studio writes no such row, so it needs
 * its own trigger — otherwise the fix above would only ever run by accident,
 * whenever some unrelated widget booking happened to refresh the same
 * organisation.
 *
 * On the staff table rather than the appointment table, because it is the staff
 * assignment that decides whose time is taken, and it is written after the
 * appointment.
 */
CREATE OR REPLACE FUNCTION chime_app.refresh_widget_availability_for_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
DECLARE
  target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  PERFORM public.chime_refresh_generated_slot_capacities(target);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chime_refresh_availability_on_staff_assignment ON chime_app.appointment_staff;
CREATE TRIGGER chime_refresh_availability_on_staff_assignment
AFTER INSERT OR DELETE ON chime_app.appointment_staff
FOR EACH ROW EXECUTE FUNCTION chime_app.refresh_widget_availability_for_staff();

/*
 * Cancelling gives the time back, and rescheduling moves it. Both change which
 * hours are taken without touching the staff table, so the appointment's own
 * status and times have to trigger a refresh as well.
 */
CREATE OR REPLACE FUNCTION chime_app.refresh_widget_availability_for_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
BEGIN
  PERFORM public.chime_refresh_generated_slot_capacities(NEW.organization_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chime_refresh_availability_on_appointment_change ON chime_app.appointments;
CREATE TRIGGER chime_refresh_availability_on_appointment_change
AFTER UPDATE OF status, starts_at, ends_at ON chime_app.appointments
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.starts_at IS DISTINCT FROM NEW.starts_at
  OR OLD.ends_at IS DISTINCT FROM NEW.ends_at
)
EXECUTE FUNCTION chime_app.refresh_widget_availability_for_appointment();

COMMIT;
