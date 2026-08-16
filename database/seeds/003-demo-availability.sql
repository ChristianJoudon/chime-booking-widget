-- Weekday working hours for the three demo team members.
--
-- Without this, a freshly initialized database has zero availability rules, so
-- Availability Studio reports "no active team schedules" and the Launch
-- readiness check for booking hours can never pass on a new install.
--
-- Monday-Friday, 9:00-17:00, Pacific/Honolulu, matching the demo organization.

BEGIN;

INSERT INTO chime_app.availability_rules (
  organization_id, subject_type, subject_id,
  day_of_week, local_start_time, local_end_time, time_zone, is_active
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'staff',
  staff_member.id,
  weekday,
  TIME '09:00',
  TIME '17:00',
  'Pacific/Honolulu',
  true
FROM chime_app.staff_members staff_member
CROSS JOIN generate_series(1, 5) AS weekday
WHERE staff_member.organization_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND staff_member.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM chime_app.availability_rules existing
    WHERE existing.organization_id = staff_member.organization_id
      AND existing.subject_type = 'staff'
      AND existing.subject_id = staff_member.id
      AND existing.day_of_week = weekday
  );

COMMIT;
