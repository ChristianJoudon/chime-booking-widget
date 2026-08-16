-- Demo customers for the Sea & Kin Studio workspace.
--
-- These fixed UUIDs are referenced by 002-demo-schedule.sql. Without this file
-- that seed fails on a fresh database, because chime_app.appointments carries a
-- composite foreign key to (organization_id, id) on chime_app.customers.
--
-- Every address uses the reserved .invalid TLD so demo data can never reach a
-- real inbox. Load this before 002-demo-schedule.sql.

BEGIN;

INSERT INTO chime_app.customers (
  id, organization_id, display_name, email, time_zone,
  marketing_consent, lifecycle_status, preferred_channel, locale, metadata, origin
)
VALUES
  ('0bc82e8b-b769-440a-bff2-dc839dd41104', '00000000-0000-4000-8000-000000000001',
   'Maya Kealoha',   'maya.kealoha@example.invalid',   'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo'),
  ('3809f3cb-8157-4cef-836e-64114ed8c088', '00000000-0000-4000-8000-000000000001',
   'Aiko Tanaka',    'aiko.tanaka@example.invalid',    'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo'),
  ('de2ee736-ad82-4270-a9dd-db4389065565', '00000000-0000-4000-8000-000000000001',
   'Jonah Park',     'jonah.park@example.invalid',     'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo'),
  ('8f167fcc-4fb9-4d31-a93e-2a789c16e0b1', '00000000-0000-4000-8000-000000000001',
   'Elena Martinez', 'elena.martinez@example.invalid', 'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo'),
  ('4ffd03dc-534c-4019-8c3b-bf64435df217', '00000000-0000-4000-8000-000000000001',
   'Leilani Cruz',   'leilani.cruz@example.invalid',   'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo'),
  ('6e370b8b-855b-47cf-af4a-ef1df1046ecf', '00000000-0000-4000-8000-000000000001',
   'Noah Santos',    'noah.santos@example.invalid',    'Pacific/Honolulu',
   false, 'active', 'email', 'en', '{"demoProfile": true}'::jsonb, 'demo')
ON CONFLICT (id) DO NOTHING;

COMMIT;
