BEGIN;

ALTER TABLE chime_app.notification_templates
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'plain',
  ADD COLUMN IF NOT EXISTS source_asset_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_templates_content_format_check'
      AND conrelid = 'chime_app.notification_templates'::regclass
  ) THEN
    ALTER TABLE chime_app.notification_templates
      ADD CONSTRAINT notification_templates_content_format_check
      CHECK (content_format IN ('plain', 'rich', 'html', 'image'));
  END IF;
END $$;

INSERT INTO chime_app.notification_templates (
  organization_id,
  template_key,
  channel,
  display_name,
  subject_template,
  body_template,
  body_html,
  content_format,
  is_active
)
SELECT
  organization.id,
  'newsletter_outreach',
  'email',
  'Newsletter outreach',
  'A little update from our team',
  E'Hi {{customer.name}},\n\nAdd your newsletter message here.\n\nWe are glad you are here.',
  '<div style="font-family:Helvetica Neue,Arial,sans-serif;color:#23443a;line-height:1.65"><p>Hi <strong>{{customer.name}}</strong>,</p><h2 style="color:#236c55">A little update from our team</h2><p>Add your newsletter message here.</p><p>We are glad you are here.</p></div>',
  'rich',
  true
FROM chime_app.organizations organization
ON CONFLICT (organization_id, template_key, channel) DO NOTHING;

COMMIT;
