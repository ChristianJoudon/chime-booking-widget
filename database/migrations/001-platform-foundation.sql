-- Chime standalone platform foundation.
-- This migration is additive and does not alter the existing public demo tables.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS chime_app;

COMMENT ON SCHEMA chime_app IS
  'Portable small-business appointment booking platform owned by Chime.';

CREATE TABLE IF NOT EXISTS chime_app.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  default_time_zone TEXT NOT NULL,
  default_currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chime_app.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  auth_subject TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chime_users_email_unique
  ON chime_app.users (lower(email));

CREATE TABLE IF NOT EXISTS chime_app.memberships (
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES chime_app.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'admin', 'manager', 'staff', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS chime_app.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS chime_app.staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES chime_app.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  color TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS chime_staff_user_unique
  ON chime_app.staff_members (organization_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chime_app.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  location_id UUID,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('room', 'chair', 'equipment', 'vehicle', 'other')),
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES chime_app.locations(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chime_app.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  short_description TEXT,
  default_duration_minutes INTEGER NOT NULL CHECK (default_duration_minutes > 0),
  minimum_duration_minutes INTEGER NOT NULL CHECK (minimum_duration_minutes > 0),
  maximum_duration_minutes INTEGER NOT NULL CHECK (maximum_duration_minutes > 0),
  duration_increment_minutes INTEGER NOT NULL CHECK (duration_increment_minutes > 0),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  minimum_notice_minutes INTEGER NOT NULL DEFAULT 0 CHECK (minimum_notice_minutes >= 0),
  maximum_advance_days INTEGER NOT NULL DEFAULT 90 CHECK (maximum_advance_days > 0),
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency CHAR(3) NOT NULL,
  deposit_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (deposit_mode IN ('none', 'fixed', 'percentage', 'full')),
  deposit_amount_minor INTEGER CHECK (deposit_amount_minor IS NULL OR deposit_amount_minor >= 0),
  deposit_percentage NUMERIC(5, 2)
    CHECK (deposit_percentage IS NULL OR (deposit_percentage > 0 AND deposit_percentage <= 100)),
  confirmation_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (confirmation_mode IN ('automatic', 'manual')),
  change_approval_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (
      change_approval_mode IN (
        'automatic',
        'business',
        'affected_staff',
        'business_and_affected_staff'
      )
    ),
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  custom_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug),
  CHECK (minimum_duration_minutes <= default_duration_minutes),
  CHECK (default_duration_minutes <= maximum_duration_minutes)
);

CREATE TABLE IF NOT EXISTS chime_app.service_locations (
  organization_id UUID NOT NULL,
  service_id UUID NOT NULL,
  location_id UUID NOT NULL,
  PRIMARY KEY (organization_id, service_id, location_id),
  FOREIGN KEY (organization_id, service_id)
    REFERENCES chime_app.services(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, location_id)
    REFERENCES chime_app.locations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chime_app.service_staff (
  organization_id UUID NOT NULL,
  service_id UUID NOT NULL,
  staff_member_id UUID NOT NULL,
  PRIMARY KEY (organization_id, service_id, staff_member_id),
  FOREIGN KEY (organization_id, service_id)
    REFERENCES chime_app.services(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, staff_member_id)
    REFERENCES chime_app.staff_members(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chime_app.service_resources (
  organization_id UUID NOT NULL,
  service_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (organization_id, service_id, resource_id),
  FOREIGN KEY (organization_id, service_id)
    REFERENCES chime_app.services(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, resource_id)
    REFERENCES chime_app.resources(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chime_app.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  time_zone TEXT,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS chime_customers_email_lookup
  ON chime_app.customers (organization_id, lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS chime_app.availability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('organization', 'location', 'staff', 'resource', 'service')),
  subject_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  local_start_time TIME NOT NULL,
  local_end_time TIME NOT NULL,
  time_zone TEXT NOT NULL,
  effective_from DATE,
  effective_until DATE,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (local_start_time < local_end_time),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_from <= effective_until)
);

CREATE INDEX IF NOT EXISTS chime_availability_rules_subject
  ON chime_app.availability_rules (organization_id, subject_type, subject_id, day_of_week);

CREATE TABLE IF NOT EXISTS chime_app.availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('organization', 'location', 'staff', 'resource', 'service')),
  subject_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL
    CHECK (mode IN ('available', 'unavailable', 'capacity_override')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS chime_availability_exceptions_window
  ON chime_app.availability_exceptions (organization_id, subject_type, subject_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS chime_app.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  reference_code TEXT NOT NULL,
  service_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  location_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'draft',
        'held',
        'pending_payment',
        'pending_approval',
        'confirmed',
        'change_pending',
        'cancelled',
        'completed',
        'no_show',
        'expired',
        'declined'
      )
    ),
  source TEXT NOT NULL
    CHECK (source IN ('widget', 'admin', 'customer_portal', 'api', 'import')),
  confirmation_mode TEXT NOT NULL
    CHECK (confirmation_mode IN ('automatic', 'manual')),
  change_approval_mode TEXT NOT NULL
    CHECK (
      change_approval_mode IN (
        'automatic',
        'business',
        'affected_staff',
        'business_and_affected_staff'
      )
    ),
  customer_notes TEXT,
  internal_notes TEXT,
  custom_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, reference_code),
  FOREIGN KEY (organization_id, service_id)
    REFERENCES chime_app.services(organization_id, id),
  FOREIGN KEY (organization_id, customer_id)
    REFERENCES chime_app.customers(organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES chime_app.locations(organization_id, id),
  CHECK (starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS chime_appointments_calendar
  ON chime_app.appointments (organization_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS chime_appointments_status
  ON chime_app.appointments (organization_id, status, starts_at);

CREATE TABLE IF NOT EXISTS chime_app.appointment_staff (
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  staff_member_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'assigned'
    CHECK (role IN ('assigned', 'requested', 'observer')),
  PRIMARY KEY (organization_id, appointment_id, staff_member_id),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, staff_member_id)
    REFERENCES chime_app.staff_members(organization_id, id)
);

CREATE INDEX IF NOT EXISTS chime_appointment_staff_calendar
  ON chime_app.appointment_staff (organization_id, staff_member_id, appointment_id);

CREATE TABLE IF NOT EXISTS chime_app.appointment_resources (
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (organization_id, appointment_id, resource_id),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, resource_id)
    REFERENCES chime_app.resources(organization_id, id)
);

CREATE TABLE IF NOT EXISTS chime_app.appointment_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  customer_id UUID,
  staff_member_id UUID,
  participant_kind TEXT NOT NULL
    CHECK (participant_kind IN ('customer', 'staff', 'guest')),
  display_name TEXT,
  email TEXT,
  notification_preference TEXT NOT NULL DEFAULT 'email'
    CHECK (notification_preference IN ('email', 'sms', 'both', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, customer_id)
    REFERENCES chime_app.customers(organization_id, id),
  FOREIGN KEY (organization_id, staff_member_id)
    REFERENCES chime_app.staff_members(organization_id, id),
  CHECK (
    (participant_kind = 'customer' AND customer_id IS NOT NULL AND staff_member_id IS NULL)
    OR (participant_kind = 'staff' AND staff_member_id IS NOT NULL AND customer_id IS NULL)
    OR (participant_kind = 'guest' AND customer_id IS NULL AND staff_member_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS chime_app.appointment_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  appointment_id UUID,
  service_id UUID NOT NULL,
  customer_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'converted', 'released', 'expired')),
  idempotency_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, service_id)
    REFERENCES chime_app.services(organization_id, id),
  FOREIGN KEY (organization_id, customer_id)
    REFERENCES chime_app.customers(organization_id, id),
  CHECK (starts_at < ends_at),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS chime_active_holds_window
  ON chime_app.appointment_holds (organization_id, starts_at, ends_at, expires_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS chime_app.appointment_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  base_appointment_version INTEGER NOT NULL CHECK (base_appointment_version > 0),
  requested_by_kind TEXT NOT NULL
    CHECK (requested_by_kind IN ('user', 'customer', 'system')),
  requested_by_user_id UUID REFERENCES chime_app.users(id),
  requested_by_customer_id UUID,
  proposed_changes JSONB NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'approved', 'declined', 'expired', 'withdrawn', 'superseded')),
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by_customer_id)
    REFERENCES chime_app.customers(organization_id, id),
  CHECK (
    (requested_by_kind = 'user' AND requested_by_user_id IS NOT NULL AND requested_by_customer_id IS NULL)
    OR (requested_by_kind = 'customer' AND requested_by_user_id IS NULL AND requested_by_customer_id IS NOT NULL)
    OR (requested_by_kind = 'system' AND requested_by_user_id IS NULL AND requested_by_customer_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS chime_pending_change_requests
  ON chime_app.appointment_change_requests (organization_id, status, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS chime_app.appointment_change_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  change_request_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'decline')),
  decided_by_kind TEXT NOT NULL CHECK (decided_by_kind IN ('user', 'customer')),
  decided_by_user_id UUID REFERENCES chime_app.users(id),
  decided_by_customer_id UUID,
  note TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, change_request_id)
    REFERENCES chime_app.appointment_change_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, decided_by_customer_id)
    REFERENCES chime_app.customers(organization_id, id),
  CHECK (
    (decided_by_kind = 'user' AND decided_by_user_id IS NOT NULL AND decided_by_customer_id IS NULL)
    OR (decided_by_kind = 'customer' AND decided_by_user_id IS NULL AND decided_by_customer_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS chime_app.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('requires_payment', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  CHECK (status <> 'succeeded' OR verified_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS chime_app.terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  terms_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, customer_id)
    REFERENCES chime_app.customers(organization_id, id)
);

CREATE TABLE IF NOT EXISTS chime_app.widget_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  location_id UUID,
  slug TEXT NOT NULL,
  enabled_service_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  copy JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  locale TEXT NOT NULL DEFAULT 'en-US',
  time_zone TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES chime_app.locations(organization_id, id)
);

CREATE TABLE IF NOT EXISTS chime_app.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'customer', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB,
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chime_audit_entity_history
  ON chime_app.audit_events (organization_id, entity_type, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS chime_app.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS chime_outbox_ready
  ON chime_app.outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS chime_app.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  outbox_event_id UUID REFERENCES chime_app.outbox_events(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'webhook')),
  recipient TEXT NOT NULL,
  template_key TEXT NOT NULL,
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'suppressed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION chime_app.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations',
    'users',
    'memberships',
    'locations',
    'staff_members',
    'resources',
    'services',
    'customers',
    'availability_rules',
    'availability_exceptions',
    'appointments',
    'appointment_holds',
    'appointment_change_requests',
    'payments',
    'widget_configs',
    'notification_deliveries'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS touch_updated_at ON chime_app.%I',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON chime_app.%I '
      'FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
