-- Local-only Chime admin tenant. Run after 001-platform-foundation.sql.
-- These identifiers contain no production credentials or customer data.

BEGIN;

INSERT INTO chime_app.organizations (
  id, name, slug, default_time_zone, default_currency, status
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Sea & Kin Studio',
  'sea-and-kin',
  'Pacific/Honolulu',
  'USD',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  default_time_zone = EXCLUDED.default_time_zone,
  default_currency = EXCLUDED.default_currency,
  status = EXCLUDED.status;

INSERT INTO chime_app.users (id, email, display_name, status)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'owner@chime.local',
  'Demo Owner',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status;

INSERT INTO chime_app.memberships (organization_id, user_id, role)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000101',
  'owner'
)
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO chime_app.locations (id, organization_id, name, slug, time_zone)
VALUES
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000001', 'Studio A', 'studio-a', 'Pacific/Honolulu'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', 'Studio B', 'studio-b', 'Pacific/Honolulu')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time_zone = EXCLUDED.time_zone, is_active = true;

INSERT INTO chime_app.staff_members (id, organization_id, display_name, email, color)
VALUES
  ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000000001', 'Mara Kealoha', 'mara@chime.local', '#348469'),
  ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000000001', 'Noah Reyes', 'noah@chime.local', '#477aab'),
  ('00000000-0000-4000-8000-000000002003', '00000000-0000-4000-8000-000000000001', 'Lei Nakamura', 'lei@chime.local', '#bf5734')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  color = EXCLUDED.color,
  is_active = true;

INSERT INTO chime_app.services (
  id, organization_id, name, slug, short_description,
  default_duration_minutes, minimum_duration_minutes, maximum_duration_minutes,
  duration_increment_minutes, buffer_before_minutes, buffer_after_minutes,
  minimum_notice_minutes, maximum_advance_days, price_minor, currency,
  deposit_mode, deposit_amount_minor, confirmation_mode, change_approval_mode,
  capacity, custom_questions, settings, is_active, is_public
) VALUES
  (
    '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000000001',
    'First-time consultation', 'first-time-consultation',
    'A thoughtful first visit to understand your goals and make a clear plan.',
    60, 30, 120, 15, 10, 10, 120, 90, 9500, 'USD',
    'none', NULL, 'automatic', 'business', 1, '[]'::jsonb,
    '{"category":"Consultations","tone":"mint","glyph":"chat","depositRefundable":true,"bookingWindow":{"cancellationNoticeMinutes":1440,"rescheduleNoticeMinutes":720}}'::jsonb,
    true, true
  ),
  (
    '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000000001',
    'Follow-up session', 'follow-up-session',
    'Focused time to continue the work and keep momentum moving.',
    45, 30, 90, 15, 5, 10, 60, 90, 7500, 'USD',
    'none', NULL, 'automatic', 'affected_staff', 1, '[]'::jsonb,
    '{"category":"Ongoing care","tone":"sky","glyph":"return","depositRefundable":true,"bookingWindow":{"cancellationNoticeMinutes":1440,"rescheduleNoticeMinutes":720}}'::jsonb,
    true, true
  ),
  (
    '00000000-0000-4000-8000-000000003003', '00000000-0000-4000-8000-000000000001',
    'Quick check-in', 'quick-check-in',
    'A short, practical appointment for one clear question or adjustment.',
    30, 15, 45, 15, 5, 5, 30, 45, 4500, 'USD',
    'none', NULL, 'automatic', 'automatic', 1, '[]'::jsonb,
    '{"category":"Ongoing care","tone":"lemon","glyph":"bolt","depositRefundable":true,"bookingWindow":{"cancellationNoticeMinutes":1440,"rescheduleNoticeMinutes":720}}'::jsonb,
    true, true
  ),
  (
    '00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000000001',
    'Extended service', 'extended-service',
    'Extra room for a more involved session without feeling rushed.',
    90, 60, 180, 30, 15, 20, 1440, 90, 14500, 'USD',
    'fixed', 2500, 'manual', 'business_and_affected_staff', 1, '[]'::jsonb,
    '{"category":"Specialty","tone":"peach","glyph":"sparkles","depositRefundable":true,"bookingWindow":{"cancellationNoticeMinutes":1440,"rescheduleNoticeMinutes":720}}'::jsonb,
    true, true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  short_description = EXCLUDED.short_description,
  settings = EXCLUDED.settings,
  is_active = EXCLUDED.is_active,
  is_public = EXCLUDED.is_public;

INSERT INTO chime_app.service_locations (organization_id, service_id, location_id)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000001001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000001002'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000001001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000001002'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003003', '00000000-0000-4000-8000-000000001001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000001001')
ON CONFLICT DO NOTHING;

INSERT INTO chime_app.service_staff (organization_id, service_id, staff_member_id)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000002002'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000002002'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000002003'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003003', '00000000-0000-4000-8000-000000002003'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000002001'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000002003')
ON CONFLICT DO NOTHING;

COMMIT;
