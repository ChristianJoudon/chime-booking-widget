BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.business_settings (
  organization_id uuid PRIMARY KEY REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  public_name text NOT NULL,
  business_type text NOT NULL DEFAULT 'other'
    CHECK (business_type IN ('consulting', 'beauty', 'wellness', 'coaching', 'education', 'home_services', 'repair', 'other')),
  service_mode text NOT NULL DEFAULT 'business_location'
    CHECK (service_mode IN ('business_location', 'mobile', 'virtual', 'mixed')),
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  website_url text NOT NULL DEFAULT '',
  time_zone text NOT NULL DEFAULT 'Pacific/Honolulu',
  currency char(3) NOT NULL DEFAULT 'USD',
  booking_page_slug text NOT NULL,
  appointment_increment_minutes integer NOT NULL DEFAULT 15
    CHECK (appointment_increment_minutes IN (5, 10, 15, 20, 30, 60)),
  minimum_notice_minutes integer NOT NULL DEFAULT 120
    CHECK (minimum_notice_minutes BETWEEN 0 AND 10080),
  maximum_advance_days integer NOT NULL DEFAULT 60
    CHECK (maximum_advance_days BETWEEN 1 AND 730),
  confirmation_mode text NOT NULL DEFAULT 'automatic'
    CHECK (confirmation_mode IN ('automatic', 'manual')),
  change_policy text NOT NULL DEFAULT 'customer_approval'
    CHECK (change_policy IN ('instant', 'customer_approval', 'business_review')),
  customer_cancellation_allowed boolean NOT NULL DEFAULT true,
  customer_rescheduling_allowed boolean NOT NULL DEFAULT true,
  cancellation_notice_minutes integer NOT NULL DEFAULT 1440
    CHECK (cancellation_notice_minutes BETWEEN 0 AND 43200),
  reschedule_notice_minutes integer NOT NULL DEFAULT 1440
    CHECK (reschedule_notice_minutes BETWEEN 0 AND 43200),
  customer_welcome_message text NOT NULL DEFAULT 'Choose the service and time that work best for you.',
  confirmation_message text NOT NULL DEFAULT 'Your appointment is on the calendar. We look forward to seeing you.',
  cancellation_policy_summary text NOT NULL DEFAULT 'Please give us advance notice if your plans change.',
  last_idempotency_key text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_settings_booking_slug_unique
  ON chime_app.business_settings (lower(booking_page_slug));

INSERT INTO chime_app.business_settings (
  organization_id,
  business_name,
  public_name,
  booking_page_slug
)
SELECT
  organization.id,
  organization.name,
  organization.name,
  COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower(organization.name), '[^a-z0-9]+', '-', 'g')), ''), 'business')
    || '-' || left(organization.id::text, 8)
FROM chime_app.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

DROP TRIGGER IF EXISTS touch_business_settings_updated_at ON chime_app.business_settings;
CREATE TRIGGER touch_business_settings_updated_at
BEFORE UPDATE ON chime_app.business_settings
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at();

COMMIT;
