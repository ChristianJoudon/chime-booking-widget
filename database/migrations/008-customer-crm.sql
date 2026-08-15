BEGIN;

ALTER TABLE chime_app.customers
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS preferred_channel text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  ALTER TABLE chime_app.customers
    ADD CONSTRAINT customers_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'vip', 'watchlist', 'blocked', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE chime_app.customers
    ADD CONSTRAINT customers_preferred_channel_check
    CHECK (preferred_channel IN ('email', 'sms', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE chime_app.customers
    ADD CONSTRAINT customers_version_check CHECK (version > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS customers_directory_search_idx
  ON chime_app.customers (organization_id, lifecycle_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chime_app.customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#5f927f',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_tags_name_check CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  CONSTRAINT customer_tags_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_tags_org_name_unique
  ON chime_app.customer_tags (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS chime_app.customer_tag_assignments (
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES chime_app.customers(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES chime_app.customer_tags(id) ON DELETE CASCADE,
  created_by_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE INDEX IF NOT EXISTS customer_tag_assignments_org_tag_idx
  ON chime_app.customer_tag_assignments (organization_id, tag_id, customer_id);

CREATE TABLE IF NOT EXISTS chime_app.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES chime_app.customers(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  created_by_role text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_body_check CHECK (char_length(trim(body)) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS customer_notes_customer_timeline_idx
  ON chime_app.customer_notes (organization_id, customer_id, is_pinned DESC, created_at DESC);

INSERT INTO chime_app.customer_tags (organization_id, name, color)
SELECT organization_id, seed.name, seed.color
FROM (SELECT id AS organization_id FROM chime_app.organizations) organizations
CROSS JOIN (VALUES
  ('VIP', '#c58a62'),
  ('Needs follow-up', '#d4a53e'),
  ('New client', '#5f8fb1')
) AS seed(name, color)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION chime_app.touch_customer_crm_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_tags_touch_updated_at ON chime_app.customer_tags;
CREATE TRIGGER customer_tags_touch_updated_at
BEFORE UPDATE ON chime_app.customer_tags
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_customer_crm_record();

DROP TRIGGER IF EXISTS customer_notes_touch_updated_at ON chime_app.customer_notes;
CREATE TRIGGER customer_notes_touch_updated_at
BEFORE UPDATE ON chime_app.customer_notes
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_customer_crm_record();

CREATE OR REPLACE FUNCTION chime_app.enforce_customer_delivery_preference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_record record;
BEGIN
  IF NEW.status NOT IN ('pending', 'retrying') OR NEW.channel NOT IN ('email', 'sms') THEN
    RETURN NEW;
  END IF;

  SELECT
    email_notifications_enabled,
    sms_notifications_enabled,
    lifecycle_status
  INTO customer_record
  FROM chime_app.customers
  WHERE organization_id = NEW.organization_id
    AND (
      id::text = COALESCE(NEW.metadata ->> 'customerId', NEW.metadata ->> 'customer_id')
      OR (NEW.channel = 'email' AND email IS NOT NULL AND lower(email) = lower(NEW.recipient))
      OR (NEW.channel = 'sms' AND phone IS NOT NULL AND phone = NEW.recipient)
    )
  ORDER BY
    CASE WHEN id::text = COALESCE(NEW.metadata ->> 'customerId', NEW.metadata ->> 'customer_id') THEN 0 ELSE 1 END
  LIMIT 1;

  IF FOUND AND (
    customer_record.lifecycle_status IN ('blocked', 'archived')
    OR (NEW.channel = 'email' AND NOT customer_record.email_notifications_enabled)
    OR (NEW.channel = 'sms' AND NOT customer_record.sms_notifications_enabled)
  ) THEN
    NEW.status = 'suppressed';
    NEW.last_error = 'Suppressed by customer contact preference';
    NEW.completed_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_delivery_customer_preference ON chime_app.notification_deliveries;
CREATE TRIGGER notification_delivery_customer_preference
BEFORE INSERT ON chime_app.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION chime_app.enforce_customer_delivery_preference();

COMMIT;
