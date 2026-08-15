BEGIN;

ALTER TABLE chime_app.notification_deliveries
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chime_app.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;

ALTER TABLE chime_app.notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'suppressed'));

CREATE INDEX IF NOT EXISTS chime_notification_delivery_ready
  ON chime_app.notification_deliveries (available_at, created_at)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE TABLE IF NOT EXISTS chime_app.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'webhook')),
  display_name text NOT NULL,
  subject_template text,
  body_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key, channel)
);

CREATE TABLE IF NOT EXISTS chime_app.notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES chime_app.notification_deliveries(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('sandbox', 'live')),
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chime_notification_attempt_history
  ON chime_app.notification_attempts (organization_id, delivery_id, started_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'touch_notification_templates_updated_at'
  ) THEN
    CREATE TRIGGER touch_notification_templates_updated_at
      BEFORE UPDATE ON chime_app.notification_templates
      FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at();
  END IF;
END $$;

INSERT INTO chime_app.notification_templates (
  organization_id,
  template_key,
  channel,
  display_name,
  subject_template,
  body_template
)
SELECT
  organization.id,
  seed.template_key,
  seed.channel,
  seed.display_name,
  seed.subject_template,
  seed.body_template
FROM chime_app.organizations organization
CROSS JOIN (
  VALUES
    ('booking_received', 'email', 'Booking received',
      'We received your {{service.name}} appointment',
      'Hi {{customer.name}},\n\nWe received your {{service.name}} appointment for {{appointment.when}}. We will let you know as soon as it is confirmed.\n\nReference: {{appointment.referenceCode}}'),
    ('booking_confirmed', 'email', 'Booking confirmed',
      'Your {{service.name}} appointment is confirmed',
      'Hi {{customer.name}},\n\nYour {{service.name}} appointment is confirmed for {{appointment.when}} with {{staff.name}} at {{location.name}}.\n\nReference: {{appointment.referenceCode}}'),
    ('appointment_change_requested', 'email', 'Appointment change requested',
      'Please review a change to your appointment',
      'Hi {{customer.name}},\n\nA new time was proposed for your {{service.name}} appointment. Review the original and proposed time here:\n\n{{approval.url}}\n\nYour original appointment remains in place until you approve.'),
    ('appointment_change_approved', 'email', 'Appointment change approved',
      'Your new appointment time is confirmed',
      'Hi {{customer.name}},\n\nYour updated {{service.name}} appointment is confirmed for {{appointment.when}} with {{staff.name}} at {{location.name}}.\n\nReference: {{appointment.referenceCode}}'),
    ('appointment_change_declined', 'email', 'Original appointment kept',
      'Your original appointment time is still confirmed',
      'Hi {{customer.name}},\n\nWe kept your original {{service.name}} appointment at {{appointment.when}}. No changes were made.\n\nReference: {{appointment.referenceCode}}'),
    ('booking_received', 'sms', 'Booking received text', NULL,
      'Chime: We received your {{service.name}} appointment for {{appointment.when}}. Ref {{appointment.referenceCode}}.'),
    ('booking_confirmed', 'sms', 'Booking confirmed text', NULL,
      'Chime: Your {{service.name}} appointment is confirmed for {{appointment.when}}. Ref {{appointment.referenceCode}}.'),
    ('appointment_change_requested', 'sms', 'Appointment change text', NULL,
      'Chime: A new appointment time was proposed. Review it here: {{approval.url}}'),
    ('appointment_change_approved', 'sms', 'Change approved text', NULL,
      'Chime: Your updated appointment is confirmed for {{appointment.when}}.'),
    ('appointment_change_declined', 'sms', 'Change declined text', NULL,
      'Chime: Your original appointment remains confirmed for {{appointment.when}}.')
) AS seed(template_key, channel, display_name, subject_template, body_template)
ON CONFLICT (organization_id, template_key, channel) DO NOTHING;

COMMIT;
