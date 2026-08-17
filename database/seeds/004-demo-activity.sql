-- Demo payments, a change request, and customer notes.
--
-- Without these, three screens open empty on a workspace that is otherwise
-- populated: Payments says no deposits have been taken, Requests says nothing
-- needs a person, and every customer profile has a blank notes panel. Empty is
-- a truthful state, but it is a poor first impression of screens that are
-- perfectly good once there is something in them.
--
-- Everything here hangs off the appointments in 002-demo-schedule.sql and moves
-- with them, so re-running keeps the whole demo week consistent.
--
-- Load after 002-demo-schedule.sql.

BEGIN;

/* ------------------------------------------------------------------ *
 * Deposits.
 *
 * Only for the service that actually asks for one — Extended service, at
 * $25.00. Inventing deposits for the others would put the Payments screen out
 * of step with what the Services screen says a customer is charged.
 * ------------------------------------------------------------------ */
INSERT INTO chime_app.payments (
  id, organization_id, appointment_id, provider, provider_payment_id,
  amount_minor, captured_amount_minor, refunded_amount_minor,
  currency, status, verified_at, created_at
)
SELECT
  payment.id,
  appointment.organization_id,
  appointment.id,
  'demo',
  payment.provider_reference,
  2500,
  payment.captured,
  payment.refunded,
  'USD',
  payment.status,
  -- A collected deposit must carry proof it was verified with the provider:
  -- chime_app.payments has a check that status = 'succeeded' implies
  -- verified_at IS NOT NULL. An authorization has not been verified yet.
  CASE WHEN payment.status = 'succeeded'
       THEN appointment.starts_at - interval '2 days' + interval '4 seconds'
       ELSE NULL END,
  appointment.starts_at - interval '2 days'
FROM (VALUES
  ('20000000-0000-4000-8000-000000005001'::uuid, 'CH-SCHED-1004', 'pi_demo_extended_a', 2500, 0, 'succeeded'),
  ('20000000-0000-4000-8000-000000005002'::uuid, 'CH-SCHED-1009', 'pi_demo_extended_b', 0, 0, 'authorized')
) AS payment(id, reference_code, provider_reference, captured, refunded, status)
JOIN chime_app.appointments appointment
  ON appointment.reference_code = payment.reference_code
 AND appointment.origin = 'demo'
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  captured_amount_minor = EXCLUDED.captured_amount_minor,
  verified_at = EXCLUDED.verified_at,
  created_at = EXCLUDED.created_at,
  updated_at = now();

/* ------------------------------------------------------------------ *
 * One change request waiting on a person.
 *
 * Requests is the screen with a count badge in the navigation, so leaving it
 * empty makes that badge look broken. This asks to move the Thursday extended
 * session an hour later.
 * ------------------------------------------------------------------ */
INSERT INTO chime_app.appointment_change_requests (
  id, organization_id, appointment_id, base_appointment_version,
  requested_by_kind, requested_by_customer_id,
  proposed_changes, reason, status, created_at
)
SELECT
  '30000000-0000-4000-8000-000000006001'::uuid,
  appointment.organization_id,
  appointment.id,
  -- The version the request was raised against. A decision made after the
  -- appointment moved on is refused rather than silently applied.
  appointment.version,
  'customer',
  appointment.customer_id,
  jsonb_build_object(
    'startsAt', to_char(appointment.starts_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'endsAt', to_char(appointment.ends_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF')
  ),
  'Could we start an hour later? My morning meeting tends to run over.',
  'pending',
  now() - interval '5 hours'
FROM chime_app.appointments appointment
WHERE appointment.reference_code = 'CH-SCHED-1009'
  AND appointment.origin = 'demo'
ON CONFLICT (id) DO UPDATE SET
  proposed_changes = EXCLUDED.proposed_changes,
  status = EXCLUDED.status,
  created_at = EXCLUDED.created_at,
  updated_at = now();

-- An appointment with a request pending says so in its own status, which is
-- what puts it in the Requests queue rather than only in the calendar.
UPDATE chime_app.appointments
   SET status = 'change_pending', updated_at = now()
 WHERE reference_code = 'CH-SCHED-1009'
   AND origin = 'demo';

/* ------------------------------------------------------------------ *
 * Customer notes.
 *
 * The kind a small business actually writes: preferences and context, not
 * anything sensitive. One is pinned, so the profile shows both treatments.
 * ------------------------------------------------------------------ */
INSERT INTO chime_app.customer_notes (
  id, organization_id, customer_id, body, is_pinned, created_by_role, created_at
)
SELECT
  note.id,
  customer.organization_id,
  customer.id,
  note.body,
  note.pinned,
  'owner',
  now() - note.age
FROM (VALUES
  ('40000000-0000-4000-8000-000000007001'::uuid, 'maya.kealoha@example.invalid',
   'Prefers morning appointments and a short recap by email afterwards.', true, interval '9 days'),
  ('40000000-0000-4000-8000-000000007002'::uuid, 'maya.kealoha@example.invalid',
   'Brought a colleague last visit — may book for two next time.', false, interval '3 days'),
  ('40000000-0000-4000-8000-000000007003'::uuid, 'elena.martinez@example.invalid',
   'Parking is difficult for her; suggest the side entrance.', true, interval '6 days'),
  ('40000000-0000-4000-8000-000000007004'::uuid, 'jonah.park@example.invalid',
   'Rescheduled twice in spring. Worth confirming the day before.', false, interval '12 days')
) AS note(id, email, body, pinned, age)
JOIN chime_app.customers customer
  ON customer.email = note.email
 AND customer.origin = 'demo'
ON CONFLICT (id) DO UPDATE SET
  body = EXCLUDED.body,
  is_pinned = EXCLUDED.is_pinned,
  created_at = EXCLUDED.created_at;

COMMIT;
