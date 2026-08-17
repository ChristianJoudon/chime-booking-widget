-- Seed organization defaults at provisioning time, not at migration time.
--
-- Migrations 007, 008, 011, 012 and 013 each seed organization-scoped rows with
-- `SELECT ... FROM chime_app.organizations`. That works exactly once, for the
-- organizations that existed when the migration ran. Any organization created
-- afterwards receives nothing.
--
-- The consequences differ. launch_settings self-heals, because
-- ensureLaunchSettings in launchRoutes.ts creates the row on demand.
-- notification_templates has no such fallback — there is no INSERT into that
-- table anywhere in server/src — so a second business would have no email
-- templates at all and every customer notification would fail to render.
-- Chime is a multi-tenant product for small businesses, so this lands on the
-- first real second tenant.
--
-- This migration moves the defaults into one function and calls it from a
-- trigger on organizations, so the mechanism no longer depends on when a
-- migration happened to run.
--
-- The earlier migrations are deliberately NOT edited to delegate here. They
-- have already been applied, and scripts/migrate.mjs refuses to run when an
-- applied migration's checksum changes, precisely so two databases cannot
-- silently disagree. Editing them would break every existing database. They
-- remain correct for the organizations they seeded; this takes over from here.

BEGIN;

CREATE OR REPLACE FUNCTION chime_app.provision_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name
    FROM chime_app.organizations
   WHERE id = p_organization_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Cannot provision unknown organization %', p_organization_id;
  END IF;

  -- Every insert below is ON CONFLICT DO NOTHING, so provisioning an
  -- already-provisioned organization is a no-op and the function is safe to
  -- call again after a partial failure.

  ------------------------------------------------------------------ settings
  INSERT INTO chime_app.business_settings (
    organization_id, business_name, public_name, booking_page_slug
  )
  VALUES (
    p_organization_id,
    v_name,
    v_name,
    COALESCE(
      NULLIF(trim(BOTH '-' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), ''),
      'business'
    ) || '-' || left(p_organization_id::text, 8)
  )
  ON CONFLICT (organization_id) DO NOTHING;

  ------------------------------------------------------------------- launch
  INSERT INTO chime_app.launch_settings (organization_id, public_business_id)
  VALUES (p_organization_id, 'biz_' || replace(p_organization_id::uuid::text, '-', ''))
  ON CONFLICT (organization_id) DO NOTHING;

  --------------------------------------------------------------------- tags
  INSERT INTO chime_app.customer_tags (organization_id, name, color)
  SELECT p_organization_id, seed.name, seed.color
    FROM (VALUES
      ('VIP', '#c58a62'),
      ('Needs follow-up', '#d4a53e'),
      ('New client', '#5f8fb1')
    ) AS seed(name, color)
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------- templates
  -- These use E'' strings so \n is a real newline. Migration 007 used plain
  -- strings, which stored the two characters backslash-n literally and is why
  -- existing templates render as one run-on paragraph. Fixed for existing rows
  -- at the end of this file.
  INSERT INTO chime_app.notification_templates (
    organization_id, template_key, channel, display_name,
    subject_template, body_template
  )
  SELECT p_organization_id, seed.template_key, seed.channel, seed.display_name,
         seed.subject_template, seed.body_template
    FROM (VALUES
      ('booking_received', 'email', 'Booking received',
        'We received your {{service.name}} appointment',
        E'Hi {{customer.name}},\n\nWe received your {{service.name}} appointment for {{appointment.when}}. We will let you know as soon as it is confirmed.\n\nReference: {{appointment.referenceCode}}'),
      ('booking_confirmed', 'email', 'Booking confirmed',
        'Your {{service.name}} appointment is confirmed',
        E'Hi {{customer.name}},\n\nYour {{service.name}} appointment is confirmed for {{appointment.when}} with {{staff.name}} at {{location.name}}.\n\nReference: {{appointment.referenceCode}}'),
      ('appointment_change_requested', 'email', 'Appointment change requested',
        'Please review a change to your appointment',
        E'Hi {{customer.name}},\n\nA new time was proposed for your {{service.name}} appointment. Review the original and proposed time here:\n\n{{approval.url}}\n\nYour original appointment remains in place until you approve.'),
      ('appointment_change_approved', 'email', 'Appointment change approved',
        'Your new appointment time is confirmed',
        E'Hi {{customer.name}},\n\nYour updated {{service.name}} appointment is confirmed for {{appointment.when}} with {{staff.name}} at {{location.name}}.\n\nReference: {{appointment.referenceCode}}'),
      ('appointment_change_declined', 'email', 'Original appointment kept',
        'Your original appointment time is still confirmed',
        E'Hi {{customer.name}},\n\nWe kept your original {{service.name}} appointment at {{appointment.when}}. No changes were made.\n\nReference: {{appointment.referenceCode}}'),
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

  -- The rich newsletter template, from migration 013.
  INSERT INTO chime_app.notification_templates (
    organization_id, template_key, channel, display_name,
    subject_template, body_template, body_html, content_format, is_active
  )
  VALUES (
    p_organization_id,
    'newsletter_outreach',
    'email',
    'Newsletter outreach',
    'A little update from our team',
    E'Hi {{customer.name}},\n\nAdd your newsletter message here.\n\nWe are glad you are here.',
    '<div style="font-family:Helvetica Neue,Arial,sans-serif;color:#23443a;line-height:1.65"><p>Hi <strong>{{customer.name}}</strong>,</p><h2 style="color:#236c55">A little update from our team</h2><p>Add your newsletter message here.</p><p>We are glad you are here.</p></div>',
    'rich',
    true
  )
  ON CONFLICT (organization_id, template_key, channel) DO NOTHING;
END $$;

COMMENT ON FUNCTION chime_app.provision_organization(uuid) IS
  'Seeds the defaults a new business needs: notification templates, customer '
  'tags, business settings and launch settings. Idempotent. Called by the '
  'provision_new_organization trigger, so it runs however an organization is '
  'created.';

-- Fires however an organization is created — seed, API, or by hand — so the
-- defaults no longer depend on a migration having run afterwards.
CREATE OR REPLACE FUNCTION chime_app.provision_new_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM chime_app.provision_organization(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provision_new_organization ON chime_app.organizations;
CREATE TRIGGER provision_new_organization
AFTER INSERT ON chime_app.organizations
FOR EACH ROW EXECUTE FUNCTION chime_app.provision_new_organization();

-- Organizations that already exist. A no-op wherever the earlier migrations
-- already did the work; it fills the gaps for any created in between.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM chime_app.organizations LOOP
    PERFORM chime_app.provision_organization(v_id);
  END LOOP;
END $$;

-- Migration 007 wrote its bodies as plain strings, so '\n' was stored as the
-- two characters backslash and n rather than a newline. Those templates render
-- as one run-on paragraph. This is the "legacy escaped line breaks" item in the
-- tightening plan; repairing it here keeps existing organizations consistent
-- with ones provisioned by the function above, rather than leaving the first
-- tenant with worse templates than the second.
-- position() rather than LIKE: in a LIKE pattern a backslash is the escape
-- character, so '%\n%' would mean "contains the letter n" and match nearly
-- every row. replace() takes its arguments literally, so the repair itself is
-- correct either way, but the predicate should say what it means.
UPDATE chime_app.notification_templates
   SET body_template = replace(body_template, '\n', E'\n')
 WHERE position('\n' in body_template) > 0;

COMMIT;
