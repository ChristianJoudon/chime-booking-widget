BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.launch_settings (
  organization_id uuid PRIMARY KEY REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  public_business_id text NOT NULL UNIQUE,
  embed_enabled boolean NOT NULL DEFAULT false,
  hosted_page_enabled boolean NOT NULL DEFAULT true,
  display_mode text NOT NULL DEFAULT 'inline'
    CHECK (display_mode IN ('inline', 'modal', 'floating_button')),
  button_label text NOT NULL DEFAULT 'Book an appointment',
  allow_any_domain boolean NOT NULL DEFAULT false,
  allowed_domains text[] NOT NULL DEFAULT ARRAY['127.0.0.1:4174', 'localhost:4174']::text[],
  loader_url text NOT NULL DEFAULT 'http://127.0.0.1:4174/embed/chime-widget.js',
  stylesheet_url text NOT NULL DEFAULT 'http://127.0.0.1:4174/embed/chime-widget.css',
  hosted_base_url text NOT NULL DEFAULT 'http://127.0.0.1:4174/book.html',
  api_base_url text NOT NULL DEFAULT 'http://127.0.0.1:8787/api/chime',
  published_at timestamptz,
  last_idempotency_key text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chime_app.embed_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  domain text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'attention')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_widget_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS embed_installations_org_domain_unique
  ON chime_app.embed_installations (organization_id, lower(domain));

CREATE INDEX IF NOT EXISTS embed_installations_org_last_seen_idx
  ON chime_app.embed_installations (organization_id, last_seen_at DESC);

INSERT INTO chime_app.launch_settings (organization_id, public_business_id)
SELECT organization.id, 'biz_' || replace(organization.id::text, '-', '')
FROM chime_app.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

DROP TRIGGER IF EXISTS touch_launch_settings_updated_at ON chime_app.launch_settings;
CREATE TRIGGER touch_launch_settings_updated_at
BEFORE UPDATE ON chime_app.launch_settings
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at();

DROP TRIGGER IF EXISTS touch_embed_installations_updated_at ON chime_app.embed_installations;
CREATE TRIGGER touch_embed_installations_updated_at
BEFORE UPDATE ON chime_app.embed_installations
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at();

COMMIT;
