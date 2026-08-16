BEGIN;

WITH schedule (
  id, reference_code, service_id, customer_id, location_id,
  starts_at, ends_at, status, customer_notes, internal_notes
) AS (
  VALUES
    ('10000000-0000-4000-8000-000000004001'::uuid, 'CH-SCHED-1001', '00000000-0000-4000-8000-000000003001'::uuid, '0bc82e8b-b769-440a-bff2-dc839dd41104'::uuid, '00000000-0000-4000-8000-000000001001'::uuid, '2026-08-10 09:00:00-10'::timestamptz, '2026-08-10 10:00:00-10'::timestamptz, 'confirmed', 'First visit. Interested in a clear starting plan.', 'Welcome Maya and leave ten minutes for questions.'),
    ('10000000-0000-4000-8000-000000004002'::uuid, 'CH-SCHED-1002', '00000000-0000-4000-8000-000000003003'::uuid, '3809f3cb-8157-4cef-836e-64114ed8c088'::uuid, '00000000-0000-4000-8000-000000001002'::uuid, '2026-08-10 11:15:00-10'::timestamptz, '2026-08-10 11:45:00-10'::timestamptz, 'confirmed', 'Quick progress review.', 'Keep this one focused on the open action items.'),
    ('10000000-0000-4000-8000-000000004003'::uuid, 'CH-SCHED-1003', '00000000-0000-4000-8000-000000003002'::uuid, 'de2ee736-ad82-4270-a9dd-db4389065565'::uuid, '00000000-0000-4000-8000-000000001001'::uuid, '2026-08-10 14:00:00-10'::timestamptz, '2026-08-10 14:45:00-10'::timestamptz, 'confirmed', 'Following up on last week.', 'Review the notes from the first consultation.'),
    ('10000000-0000-4000-8000-000000004004'::uuid, 'CH-SCHED-1004', '00000000-0000-4000-8000-000000003004'::uuid, '8f167fcc-4fb9-4d31-a93e-2a789c16e0b1'::uuid, '00000000-0000-4000-8000-000000001002'::uuid, '2026-08-11 09:00:00-10'::timestamptz, '2026-08-11 10:30:00-10'::timestamptz, 'confirmed', 'Would like extra time for a detailed working session.', 'Prepare the extended-session worksheet.'),
    ('10000000-0000-4000-8000-000000004005'::uuid, 'CH-SCHED-1005', '00000000-0000-4000-8000-000000003001'::uuid, '4ffd03dc-534c-4019-8c3b-bf64435df217'::uuid, '00000000-0000-4000-8000-000000001001'::uuid, '2026-08-11 13:00:00-10'::timestamptz, '2026-08-11 14:00:00-10'::timestamptz, 'pending_approval', 'Afternoon is best if available.', 'Confirm coverage before approving.'),
    ('10000000-0000-4000-8000-000000004006'::uuid, 'CH-SCHED-1006', '00000000-0000-4000-8000-000000003003'::uuid, '6e370b8b-855b-47cf-af4a-ef1df1046ecf'::uuid, '00000000-0000-4000-8000-000000001002'::uuid, '2026-08-12 08:30:00-10'::timestamptz, '2026-08-12 09:00:00-10'::timestamptz, 'confirmed', 'Morning check-in before work.', 'Customer prefers concise email follow-up.'),
    ('10000000-0000-4000-8000-000000004007'::uuid, 'CH-SCHED-1007', '00000000-0000-4000-8000-000000003002'::uuid, '3809f3cb-8157-4cef-836e-64114ed8c088'::uuid, '00000000-0000-4000-8000-000000001001'::uuid, '2026-08-12 15:00:00-10'::timestamptz, '2026-08-12 15:45:00-10'::timestamptz, 'confirmed', 'Second appointment this month.', 'Check progress against the previous action list.'),
    ('10000000-0000-4000-8000-000000004008'::uuid, 'CH-SCHED-1008', '00000000-0000-4000-8000-000000003001'::uuid, 'de2ee736-ad82-4270-a9dd-db4389065565'::uuid, '00000000-0000-4000-8000-000000001002'::uuid, '2026-08-13 09:30:00-10'::timestamptz, '2026-08-13 10:30:00-10'::timestamptz, 'confirmed', 'New project consultation.', 'Bring the discovery prompts.'),
    ('10000000-0000-4000-8000-000000004009'::uuid, 'CH-SCHED-1009', '00000000-0000-4000-8000-000000003004'::uuid, '8f167fcc-4fb9-4d31-a93e-2a789c16e0b1'::uuid, '00000000-0000-4000-8000-000000001001'::uuid, '2026-08-13 13:00:00-10'::timestamptz, '2026-08-13 14:30:00-10'::timestamptz, 'pending_approval', 'Can stay flexible by about thirty minutes.', 'Approve after confirming Studio A.'),
    ('10000000-0000-4000-8000-000000004010'::uuid, 'CH-SCHED-1010', '00000000-0000-4000-8000-000000003003'::uuid, '4ffd03dc-534c-4019-8c3b-bf64435df217'::uuid, '00000000-0000-4000-8000-000000001002'::uuid, '2026-08-14 10:30:00-10'::timestamptz, '2026-08-14 11:00:00-10'::timestamptz, 'confirmed', 'Friday check-in.', 'Send a short recap afterward.')
)
INSERT INTO chime_app.appointments (
  id, organization_id, reference_code, service_id, customer_id, location_id,
  starts_at, ends_at, time_zone, status, source,
  confirmation_mode, change_approval_mode,
  customer_notes, internal_notes, custom_answers, origin
)
SELECT
  schedule.id,
  '00000000-0000-4000-8000-000000000001'::uuid,
  schedule.reference_code,
  schedule.service_id,
  schedule.customer_id,
  schedule.location_id,
  schedule.starts_at,
  schedule.ends_at,
  'Pacific/Honolulu',
  schedule.status,
    'admin',
  service.confirmation_mode,
  service.change_approval_mode,
  schedule.customer_notes,
  schedule.internal_notes,
  jsonb_build_object('seed', 'schedule-showcase'),
  'demo'
FROM schedule
JOIN chime_app.services service
  ON service.organization_id = '00000000-0000-4000-8000-000000000001'::uuid
 AND service.id = schedule.service_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO chime_app.appointment_staff (
  organization_id, appointment_id, staff_member_id, role
)
VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000002001', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004002', '00000000-0000-4000-8000-000000002003', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004003', '00000000-0000-4000-8000-000000002002', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004004', '00000000-0000-4000-8000-000000002003', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004005', '00000000-0000-4000-8000-000000002001', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004006', '00000000-0000-4000-8000-000000002002', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004007', '00000000-0000-4000-8000-000000002003', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004008', '00000000-0000-4000-8000-000000002001', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004009', '00000000-0000-4000-8000-000000002002', 'assigned'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000004010', '00000000-0000-4000-8000-000000002003', 'assigned')
ON CONFLICT DO NOTHING;

COMMIT;
