-- Duplicate detection and safe merge for customer records.
--
-- The same person books twice with "Maya Kealoha" and "maya kealoha ", or once
-- by email and once by phone, and becomes two records. Their appointment
-- history splits across both, so neither profile tells the truth, and outreach
-- can reach them twice.
--
-- Two pieces:
--   1. normalized email and phone, generated and indexed, so duplicates can be
--      found without scanning and comparing in application code
--   2. chime_app.merge_customers(), which moves every referencing row before
--      removing the duplicate
--
-- Merging is destructive in the sense that one record stops existing, so it is
-- deliberately explicit: the caller names which record survives.

BEGIN;

-- Generated rather than maintained by triggers or application code, so they
-- cannot drift from the values they normalize.
ALTER TABLE chime_app.customers
  ADD COLUMN IF NOT EXISTS normalized_email text
  GENERATED ALWAYS AS (NULLIF(lower(trim(email)), '')) STORED;

-- Digits only, reduced to the last 10, so "+1 (808) 555-0123" and
-- "808-555-0123" produce the same key rather than differing by a country code.
--
-- Ten digits is a deliberate tradeoff. It is right for the North American
-- numbers this product is aimed at, and two international numbers from
-- different countries could in principle share their last ten. That is
-- acceptable because this only *suggests* a duplicate: merging is an explicit
-- decision a person makes after seeing both records, never automatic.
--
-- Anything shorter than 7 digits is discarded — a 4-digit extension is not
-- evidence two people are the same.
ALTER TABLE chime_app.customers
  ADD COLUMN IF NOT EXISTS normalized_phone text
  GENERATED ALWAYS AS (
    NULLIF(
      CASE
        WHEN length(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) >= 7
        THEN right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)
        ELSE ''
      END,
      ''
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS customers_normalized_email_idx
  ON chime_app.customers (organization_id, normalized_email)
  WHERE normalized_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_normalized_phone_idx
  ON chime_app.customers (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

/*
 * Moves everything belonging to p_merge_id onto p_keep_id, then deletes the
 * duplicate.
 *
 * Every table with a foreign key to customers is handled explicitly. Relying on
 * ON DELETE CASCADE would silently destroy the duplicate's notes, tags and
 * action tokens rather than preserving them, which is the opposite of what
 * merging means.
 */
CREATE OR REPLACE FUNCTION chime_app.merge_customers(
  p_organization_id uuid,
  p_keep_id uuid,
  p_merge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_keep chime_app.customers%ROWTYPE;
  v_merge chime_app.customers%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'Cannot merge a customer into itself';
  END IF;

  SELECT * INTO v_keep FROM chime_app.customers
   WHERE organization_id = p_organization_id AND id = p_keep_id;
  SELECT * INTO v_merge FROM chime_app.customers
   WHERE organization_id = p_organization_id AND id = p_merge_id;

  IF v_keep.id IS NULL OR v_merge.id IS NULL THEN
    RAISE EXCEPTION 'Both customers must exist in this organization';
  END IF;

  -- Appointment history and everything hanging off it.
  UPDATE chime_app.appointments SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('appointments', v_count);

  UPDATE chime_app.appointment_participants SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;

  UPDATE chime_app.appointment_holds SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;

  UPDATE chime_app.appointment_change_requests SET requested_by_customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND requested_by_customer_id = p_merge_id;

  UPDATE chime_app.appointment_change_decisions SET decided_by_customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND decided_by_customer_id = p_merge_id;

  UPDATE chime_app.terms_acceptances SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;

  UPDATE chime_app.customer_action_tokens SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;

  UPDATE chime_app.widget_customer_links SET customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND customer_id = p_merge_id;

  UPDATE chime_app.in_app_notifications SET recipient_customer_id = p_keep_id
   WHERE organization_id = p_organization_id AND recipient_customer_id = p_merge_id;

  UPDATE chime_app.customer_notes SET customer_id = p_keep_id
   WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('notes', v_count);

  -- (customer_id, tag_id) is the primary key, so a tag both records already
  -- carry would collide. Move what does not collide, drop the rest.
  UPDATE chime_app.customer_tag_assignments assignment
     SET customer_id = p_keep_id
   WHERE assignment.customer_id = p_merge_id
     AND NOT EXISTS (
       SELECT 1 FROM chime_app.customer_tag_assignments existing
        WHERE existing.customer_id = p_keep_id
          AND existing.tag_id = assignment.tag_id
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('tags', v_count);
  DELETE FROM chime_app.customer_tag_assignments WHERE customer_id = p_merge_id;

  -- Fill blanks on the surviving record rather than overwriting what it has.
  -- Consent is the exception: it takes the more restrictive of the two, since
  -- a person who opted out on one record has not agreed on the other.
  UPDATE chime_app.customers
     SET email = COALESCE(NULLIF(trim(v_keep.email), ''), v_merge.email),
         phone = COALESCE(NULLIF(trim(v_keep.phone), ''), v_merge.phone),
         time_zone = COALESCE(v_keep.time_zone, v_merge.time_zone),
         marketing_consent = v_keep.marketing_consent AND v_merge.marketing_consent,
         email_notifications_enabled =
           v_keep.email_notifications_enabled AND v_merge.email_notifications_enabled,
         sms_notifications_enabled =
           v_keep.sms_notifications_enabled AND v_merge.sms_notifications_enabled,
         metadata = v_merge.metadata || v_keep.metadata,
         version = v_keep.version + 1,
         updated_at = now()
   WHERE organization_id = p_organization_id AND id = p_keep_id;

  DELETE FROM chime_app.customers
   WHERE organization_id = p_organization_id AND id = p_merge_id;

  RETURN v_moved || jsonb_build_object(
    'keptId', p_keep_id,
    'mergedId', p_merge_id,
    'mergedDisplayName', v_merge.display_name
  );
END $$;

COMMENT ON FUNCTION chime_app.merge_customers(uuid, uuid, uuid) IS
  'Moves every row referencing the duplicate onto the surviving customer, then '
  'deletes the duplicate. Consent takes the more restrictive of the two.';

COMMIT;
