-- Local smoke-test identity. Never use this account or fixed UUID in production.
BEGIN;

INSERT INTO chime_app.users (id, email, display_name, status)
VALUES (
  '00000000-0000-4000-8000-000000000099',
  'viewer-smoke@chime.local',
  'Viewer Smoke Test',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status;

INSERT INTO chime_app.memberships (organization_id, user_id, role)
SELECT organization.id, '00000000-0000-4000-8000-000000000099', 'viewer'
FROM (
  SELECT id
  FROM chime_app.organizations
  WHERE status = 'active'
  ORDER BY created_at, id
  LIMIT 1
) AS organization
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

COMMIT;
