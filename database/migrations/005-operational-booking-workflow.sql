BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.widget_customer_links (
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  widget_customer_id uuid NOT NULL REFERENCES public.chime_customers(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES chime_app.customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, widget_customer_id),
  UNIQUE (organization_id, customer_id)
);

CREATE TABLE IF NOT EXISTS chime_app.widget_booking_links (
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  widget_booking_id uuid NOT NULL REFERENCES public.chime_bookings(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES chime_app.appointments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, widget_booking_id),
  UNIQUE (organization_id, appointment_id)
);

CREATE TABLE IF NOT EXISTS chime_app.in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES chime_app.appointments(id) ON DELETE CASCADE,
  change_request_id uuid REFERENCES chime_app.appointment_change_requests(id) ON DELETE CASCADE,
  audience text NOT NULL DEFAULT 'business'
    CHECK (audience IN ('business', 'customer', 'staff')),
  recipient_user_id uuid REFERENCES chime_app.users(id) ON DELETE CASCADE,
  recipient_customer_id uuid REFERENCES chime_app.customers(id) ON DELETE CASCADE,
  recipient_staff_member_id uuid REFERENCES chime_app.staff_members(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_chime_in_app_notifications_inbox
  ON chime_app.in_app_notifications (organization_id, audience, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chime_change_requests_pending
  ON chime_app.appointment_change_requests (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION chime_app.project_widget_booking(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
DECLARE
  v_booking record;
  v_service chime_app.services%ROWTYPE;
  v_customer_id uuid;
  v_appointment_id uuid;
  v_status text;
  v_time_zone text;
  v_outbox_id uuid;
  v_event_key text;
BEGIN
  SELECT
    b.*,
    c.name AS customer_name,
    c.email AS customer_email,
    c.phone AS customer_phone,
    c.notes AS customer_notes,
    c.metadata AS customer_metadata,
    slot.starts_at,
    slot.ends_at,
    slot.organization_id,
    assignment.staff_member_id,
    assignment.location_id
  INTO v_booking
  FROM public.chime_bookings b
  JOIN public.chime_customers c ON c.id = b.customer_id
  JOIN public.chime_availability_slots slot ON slot.id = b.slot_id
  LEFT JOIN public.chime_booking_assignments assignment ON assignment.booking_id = b.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND OR v_booking.organization_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT service.*
  INTO v_service
  FROM chime_app.services service
  JOIN public.chime_services public_service
    ON public_service.admin_service_id = service.id
   AND public_service.organization_id = service.organization_id
  WHERE public_service.id = v_booking.service_id
    AND service.organization_id = v_booking.organization_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT link.customer_id
  INTO v_customer_id
  FROM chime_app.widget_customer_links link
  WHERE link.organization_id = v_booking.organization_id
    AND link.widget_customer_id = v_booking.customer_id;

  IF v_customer_id IS NULL THEN
    SELECT customer.id
    INTO v_customer_id
    FROM chime_app.customers customer
    WHERE customer.organization_id = v_booking.organization_id
      AND lower(customer.email) = lower(v_booking.customer_email)
    ORDER BY customer.updated_at DESC
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid();
      INSERT INTO chime_app.customers (
        id,
        organization_id,
        display_name,
        email,
        phone,
        time_zone,
        metadata
      ) VALUES (
        v_customer_id,
        v_booking.organization_id,
        v_booking.customer_name,
        v_booking.customer_email,
        NULLIF(v_booking.customer_phone, ''),
        'Pacific/Honolulu',
        COALESCE(v_booking.customer_metadata, '{}'::jsonb)
          || jsonb_build_object('widgetCustomerId', v_booking.customer_id)
      );
    END IF;

    INSERT INTO chime_app.widget_customer_links (
      organization_id,
      widget_customer_id,
      customer_id
    ) VALUES (
      v_booking.organization_id,
      v_booking.customer_id,
      v_customer_id
    )
    ON CONFLICT (organization_id, widget_customer_id)
    DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = now();
  END IF;

  SELECT COALESCE(location.time_zone, 'Pacific/Honolulu')
  INTO v_time_zone
  FROM chime_app.locations location
  WHERE location.id = v_booking.location_id
    AND location.organization_id = v_booking.organization_id;

  v_time_zone := COALESCE(v_time_zone, 'Pacific/Honolulu');
  v_appointment_id := v_booking.id;
  v_status := CASE
    WHEN v_service.confirmation_mode = 'manual' THEN 'pending_approval'
    ELSE 'confirmed'
  END;

  INSERT INTO chime_app.appointments (
    id,
    organization_id,
    reference_code,
    service_id,
    customer_id,
    location_id,
    starts_at,
    ends_at,
    time_zone,
    status,
    source,
    confirmation_mode,
    change_approval_mode,
    customer_notes,
    custom_answers
  ) VALUES (
    v_appointment_id,
    v_booking.organization_id,
    'CH-' || upper(substr(replace(v_booking.id::text, '-', ''), 1, 8)),
    v_service.id,
    v_customer_id,
    v_booking.location_id,
    v_booking.starts_at,
    v_booking.ends_at,
    v_time_zone,
    v_status,
    'widget',
    v_service.confirmation_mode,
    v_service.change_approval_mode,
    NULLIF(v_booking.customer_notes, ''),
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO chime_app.widget_booking_links (
    organization_id,
    widget_booking_id,
    appointment_id
  ) VALUES (
    v_booking.organization_id,
    v_booking.id,
    v_appointment_id
  )
  ON CONFLICT (organization_id, widget_booking_id)
  DO UPDATE SET appointment_id = EXCLUDED.appointment_id, updated_at = now();

  IF v_booking.staff_member_id IS NOT NULL THEN
    INSERT INTO chime_app.appointment_staff (
      organization_id,
      appointment_id,
      staff_member_id,
      role
    ) VALUES (
      v_booking.organization_id,
      v_appointment_id,
      v_booking.staff_member_id,
      'assigned'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO chime_app.appointment_participants (
    id,
    organization_id,
    appointment_id,
    customer_id,
    participant_kind,
    display_name,
    email,
    notification_preference
  ) VALUES (
    gen_random_uuid(),
    v_booking.organization_id,
    v_appointment_id,
    v_customer_id,
    'customer',
    v_booking.customer_name,
    v_booking.customer_email,
    'email'
  );

  IF v_booking.staff_member_id IS NOT NULL THEN
    INSERT INTO chime_app.appointment_participants (
      id,
      organization_id,
      appointment_id,
      staff_member_id,
      participant_kind,
      display_name,
      email,
      notification_preference
    )
    SELECT
      gen_random_uuid(),
      v_booking.organization_id,
      v_appointment_id,
      staff.id,
      'staff',
      staff.display_name,
      staff.email,
      'email'
    FROM chime_app.staff_members staff
    WHERE staff.id = v_booking.staff_member_id
      AND staff.organization_id = v_booking.organization_id;
  END IF;

  v_event_key := 'widget-booking:' || v_booking.id::text;

  INSERT INTO chime_app.in_app_notifications (
    organization_id,
    appointment_id,
    audience,
    kind,
    title,
    body,
    payload,
    dedupe_key
  ) VALUES (
    v_booking.organization_id,
    v_appointment_id,
    'business',
    CASE WHEN v_status = 'pending_approval' THEN 'booking.requested' ELSE 'booking.confirmed' END,
    CASE WHEN v_status = 'pending_approval' THEN 'New booking needs approval' ELSE 'New booking confirmed' END,
    v_booking.customer_name || ' booked ' || v_service.name || '.',
    jsonb_build_object(
      'appointmentId', v_appointment_id,
      'startsAt', v_booking.starts_at,
      'status', v_status
    ),
    v_event_key || ':business'
  )
  ON CONFLICT (organization_id, dedupe_key) DO NOTHING;

  INSERT INTO chime_app.outbox_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload,
    idempotency_key
  ) VALUES (
    v_booking.organization_id,
    CASE WHEN v_status = 'pending_approval' THEN 'appointment.approval_requested' ELSE 'appointment.confirmed' END,
    'appointment',
    v_appointment_id,
    jsonb_build_object(
      'appointmentId', v_appointment_id,
      'customerId', v_customer_id,
      'startsAt', v_booking.starts_at,
      'status', v_status,
      'source', 'widget'
    ),
    v_event_key
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    SELECT event.id
    INTO v_outbox_id
    FROM chime_app.outbox_events event
    WHERE event.organization_id = v_booking.organization_id
      AND event.idempotency_key = v_event_key
    ORDER BY event.created_at DESC
    LIMIT 1;
  END IF;

  IF v_outbox_id IS NOT NULL AND NULLIF(v_booking.customer_email, '') IS NOT NULL THEN
    INSERT INTO chime_app.notification_deliveries (
      organization_id,
      outbox_event_id,
      channel,
      recipient,
      template_key,
      idempotency_key
    ) VALUES (
      v_booking.organization_id,
      v_outbox_id,
      'email',
      v_booking.customer_email,
      CASE WHEN v_status = 'pending_approval' THEN 'booking_received' ELSE 'booking_confirmed' END,
      v_event_key || ':customer-email'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO chime_app.audit_events (
    organization_id,
    actor_kind,
    action,
    entity_type,
    entity_id,
    after_state,
    correlation_id
  ) VALUES (
    v_booking.organization_id,
    'system',
    'appointment.projected_from_widget',
    'appointment',
    v_appointment_id,
    jsonb_build_object('status', v_status, 'widgetBookingId', v_booking.id),
    v_event_key
  );

  RETURN v_appointment_id;
END;
$$;

CREATE OR REPLACE FUNCTION chime_app.project_widget_booking_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
BEGIN
  PERFORM chime_app.project_widget_booking(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_chime_project_widget_booking ON public.chime_bookings;
CREATE TRIGGER zz_chime_project_widget_booking
AFTER INSERT ON public.chime_bookings
FOR EACH ROW EXECUTE FUNCTION chime_app.project_widget_booking_trigger();

CREATE OR REPLACE FUNCTION chime_app.sync_widget_booking_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE chime_app.appointments appointment
    SET status = CASE NEW.status
        WHEN 'requested' THEN 'pending_approval'
        WHEN 'confirmed' THEN 'confirmed'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'completed' THEN 'completed'
        WHEN 'no_show' THEN 'no_show'
        ELSE appointment.status
      END,
      cancelled_at = CASE WHEN NEW.status = 'cancelled' THEN now() ELSE appointment.cancelled_at END,
      completed_at = CASE WHEN NEW.status = 'completed' THEN now() ELSE appointment.completed_at END,
      updated_at = now()
    FROM chime_app.widget_booking_links link
    WHERE link.organization_id = appointment.organization_id
      AND link.appointment_id = appointment.id
      AND link.widget_booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_chime_sync_widget_booking_status ON public.chime_bookings;
CREATE TRIGGER zz_chime_sync_widget_booking_status
AFTER UPDATE OF status ON public.chime_bookings
FOR EACH ROW EXECUTE FUNCTION chime_app.sync_widget_booking_status();

CREATE OR REPLACE FUNCTION public.chime_refresh_generated_slot_capacities(
  target_organization uuid
)
RETURNS void
LANGUAGE sql
AS $$
  WITH refreshed AS (
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

CREATE OR REPLACE FUNCTION public.chime_release_cancelled_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('cancelled', 'canceled', 'declined') THEN
    DELETE FROM public.chime_booking_assignments assignment
    WHERE assignment.booking_id = NEW.id
    RETURNING assignment.slot_id INTO v_slot_id;

    IF v_slot_id IS NOT NULL THEN
      UPDATE public.chime_availability_slots slot
      SET booked_count = GREATEST(slot.booked_count - 1, 0),
          status = CASE
            WHEN GREATEST(slot.booked_count - 1, 0) < slot.capacity THEN 'available'
            ELSE slot.status
          END,
          updated_at = now()
      WHERE slot.id = v_slot_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION chime_app.remove_widget_booking_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chime_app, public, pg_temp
AS $$
DECLARE
  v_appointment_id uuid;
BEGIN
  SELECT link.appointment_id
  INTO v_appointment_id
  FROM chime_app.widget_booking_links link
  WHERE link.widget_booking_id = OLD.id;

  IF v_appointment_id IS NOT NULL THEN
    DELETE FROM chime_app.appointments WHERE id = v_appointment_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS aa_chime_remove_widget_booking_projection ON public.chime_bookings;
CREATE TRIGGER aa_chime_remove_widget_booking_projection
BEFORE DELETE ON public.chime_bookings
FOR EACH ROW EXECUTE FUNCTION chime_app.remove_widget_booking_projection();

SELECT chime_app.project_widget_booking(booking.id)
FROM public.chime_bookings booking
WHERE NOT EXISTS (
  SELECT 1
  FROM chime_app.widget_booking_links link
  WHERE link.widget_booking_id = booking.id
);

COMMIT;
