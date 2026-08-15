import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const publicApiBase = (process.env.CHIME_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8787/api/chime')
  .replace(/\/$/, '');
const adminApiBase = (process.env.CHIME_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:8788/api/chime/admin')
  .replace(/\/$/, '');
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://chime:chime@127.0.0.1:5434/chime';
const serviceId = process.env.CHIME_APPROVAL_TEST_SERVICE_ID
  ?? '00000000-0000-4000-8000-000000003003';

assert(ownerToken, 'CHIME_ADMIN_OWNER_TOKEN is required.');

const pool = new Pool({ connectionString: databaseUrl });
const createdBookingIds = new Set();
const nonce = Date.now();

async function jsonRequest(url, { expected, ...options } = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (expected !== undefined) {
    assert.equal(
      response.status,
      expected,
      `${options.method ?? 'GET'} ${url}: ${JSON.stringify(body)}`,
    );
  } else {
    assert(response.ok, `${options.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { body, response };
}

function publicRequest(path, options = {}) {
  return jsonRequest(`${publicApiBase}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
}

function adminRequest(path, options = {}) {
  return jsonRequest(`${adminApiBase}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ownerToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
}

async function availablePair() {
  const { body } = await publicRequest(`/availability?serviceId=${encodeURIComponent(serviceId)}`);
  const slots = body.availability
    .flatMap((day) => day.slots)
    .filter((slot) => slot.available);
  assert(slots.length >= 2, 'Customer approval testing requires two available slots.');

  const source = slots[0];
  const target = slots.find(
    (slot) => new Date(slot.startsAt).getTime() - new Date(source.startsAt).getTime() >= 60 * 60_000,
  ) ?? slots[1];
  return { source, target };
}

async function createBooking(label, source) {
  const email = `approval-${label}-${nonce}@example.test`;
  const { body } = await publicRequest('/bookings', {
    method: 'POST',
    body: JSON.stringify({
      serviceId,
      slotId: source.id,
      customer: {
        name: `Customer Approval ${label}`,
        email,
      },
      termsAcceptedAt: new Date().toISOString(),
    }),
  });
  assert.match(body.bookingId, /^[0-9a-f-]{36}$/i);
  createdBookingIds.add(body.bookingId);
  return { bookingId: body.bookingId, email };
}

async function loadAppointment(email) {
  const startsAt = new Date(Date.now() - 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 200 * 86_400_000).toISOString();
  const { body } = await adminRequest(
    `/operations?startsAt=${encodeURIComponent(startsAt)}&endsAt=${encodeURIComponent(endsAt)}`,
  );
  const appointment = body.appointments.find((item) => item.customer?.email === email);
  assert(appointment, `Projected administrator appointment was not found for ${email}.`);
  return appointment;
}

async function requestCustomerChange(appointment, target, label) {
  const { body } = await adminRequest(`/appointments/${appointment.id}/change-requests`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': `customer-approval-${label}-${nonce}`,
      'If-Match': String(appointment.version),
    },
    body: JSON.stringify({
      startsAt: target.startsAt,
      durationMinutes: appointment.service.durationMinutes,
      staffMemberId: appointment.staff.id,
      locationId: appointment.location?.id ?? null,
      reason: `Customer approval ${label} smoke test`,
    }),
    expected: 201,
  });
  const approvalUrl = body.customerAction?.approvalUrl;
  assert(approvalUrl, 'A customer approval URL must be returned to the administrator.');
  const token = new URL(approvalUrl).searchParams.get('token');
  assert(token, 'The customer approval URL must contain a token.');
  return { ...body, approvalUrl, token };
}

function actionRequest(token, path = '', options = {}) {
  return jsonRequest(
    `${publicApiBase}/customer-actions/${encodeURIComponent(token)}${path}`,
    {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    },
  );
}

async function storedState(bookingId, appointmentId) {
  const result = await pool.query(
    `SELECT
       appointment.starts_at,
       appointment.ends_at,
       appointment.status,
       appointment.version,
       booking.slot_id,
       slot.starts_at AS widget_starts_at,
       assignment.staff_member_id,
       change_request.status AS change_status,
       action.used_at,
       action.decision AS token_decision,
       action.token_hash
     FROM chime_app.appointments appointment
     JOIN public.chime_bookings booking
       ON booking.id = $1
     JOIN public.chime_availability_slots slot
       ON slot.id = booking.slot_id
     JOIN public.chime_booking_assignments assignment
       ON assignment.booking_id = booking.id
     LEFT JOIN chime_app.appointment_change_requests change_request
       ON change_request.organization_id = appointment.organization_id
      AND change_request.appointment_id = appointment.id
     LEFT JOIN chime_app.customer_action_tokens action
       ON action.organization_id = appointment.organization_id
      AND action.change_request_id = change_request.id
     WHERE appointment.id = $2
     ORDER BY change_request.created_at DESC
     LIMIT 1`,
    [bookingId, appointmentId],
  );
  assert.equal(result.rows.length, 1, 'The synchronized appointment and widget booking must both exist.');
  return result.rows[0];
}

async function cleanupBooking(bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query(
      `SELECT
         booking.customer_id AS widget_customer_id,
         booking.slot_id,
         link.appointment_id,
         appointment.customer_id AS admin_customer_id
       FROM public.chime_bookings booking
       LEFT JOIN chime_app.widget_booking_links link
         ON link.widget_booking_id = booking.id
       LEFT JOIN chime_app.appointments appointment
         ON appointment.id = link.appointment_id
       WHERE booking.id = $1
       FOR UPDATE OF booking`,
      [bookingId],
    );
    const state = stateResult.rows[0];
    if (!state) {
      await client.query('COMMIT');
      return;
    }

    if (state.appointment_id) {
      await client.query(
        `DELETE FROM chime_app.notification_deliveries
         WHERE outbox_event_id IN (
           SELECT id FROM chime_app.outbox_events WHERE aggregate_id = $1
         )`,
        [state.appointment_id],
      );
      await client.query(
        'DELETE FROM chime_app.outbox_events WHERE aggregate_id = $1',
        [state.appointment_id],
      );
      await client.query(
        'DELETE FROM chime_app.audit_events WHERE entity_id = $1',
        [state.appointment_id],
      );
      await client.query(
        'DELETE FROM chime_app.appointments WHERE id = $1',
        [state.appointment_id],
      );
    }

    await client.query('DELETE FROM public.chime_bookings WHERE id = $1', [bookingId]);
    await client.query(
      `UPDATE public.chime_availability_slots
       SET booked_count = GREATEST(booked_count - 1, 0),
           status = CASE
             WHEN GREATEST(booked_count - 1, 0) < capacity THEN 'available'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [state.slot_id],
    );
    await client.query(
      `DELETE FROM public.chime_customers customer
       WHERE customer.id = $1
         AND NOT EXISTS (
           SELECT 1 FROM public.chime_bookings booking WHERE booking.customer_id = customer.id
         )`,
      [state.widget_customer_id],
    );
    if (state.admin_customer_id) {
      await client.query(
        `DELETE FROM chime_app.customers customer
         WHERE customer.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM chime_app.appointments appointment
             WHERE appointment.organization_id = customer.organization_id
               AND appointment.customer_id = customer.id
           )`,
        [state.admin_customer_id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function approvalScenario() {
  const { source, target } = await availablePair();
  const booking = await createBooking('approve', source);
  const appointment = await loadAppointment(booking.email);
  const change = await requestCustomerChange(appointment, target, 'approve');
  const tokenHash = createHash('sha256').update(change.token).digest('hex');

  const tokenRecord = await pool.query(
    `SELECT token_hash, used_at, decision
     FROM chime_app.customer_action_tokens
     WHERE appointment_id = $1`,
    [appointment.id],
  );
  assert.equal(tokenRecord.rows[0]?.token_hash, tokenHash);
  assert.equal(tokenRecord.rows[0]?.used_at, null);
  assert.equal(JSON.stringify(tokenRecord.rows[0]).includes(change.token), false);

  const preview = await actionRequest(change.token);
  assert.equal(preview.body.action.status, 'pending');
  assert.equal(preview.body.action.canDecide, true);
  assert.equal(preview.body.action.current.startsAt, source.startsAt);
  assert.equal(preview.body.action.proposed.startsAt, target.startsAt);

  const approved = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve', note: 'Approved by the customer smoke test.' }),
    expected: 200,
  });
  assert.equal(approved.body.action.status, 'approved');
  assert.equal(approved.body.replayed, false);

  const replay = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve' }),
    expected: 200,
  });
  assert.equal(replay.body.replayed, true);

  const opposite = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'decline' }),
    expected: 409,
  });
  assert.equal(opposite.body.error.code, 'ACTION_ALREADY_COMPLETED');

  const stored = await storedState(booking.bookingId, appointment.id);
  assert.equal(new Date(stored.starts_at).toISOString(), target.startsAt);
  assert.equal(new Date(stored.widget_starts_at).toISOString(), target.startsAt);
  assert.equal(stored.staff_member_id, appointment.staff.id);
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.change_status, 'approved');
  assert.equal(stored.token_decision, 'approve');
  assert(stored.used_at);
  assert.equal(stored.token_hash, tokenHash);

  const notificationResult = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'appointment.change_approved')::int AS approved_events,
       COUNT(*) FILTER (WHERE event_type = 'appointment.change_requested')::int AS requested_events
     FROM chime_app.outbox_events
     WHERE aggregate_id = $1`,
    [appointment.id],
  );
  assert.equal(notificationResult.rows[0].approved_events, 1);
  assert.equal(notificationResult.rows[0].requested_events, 1);
}

async function declineScenario() {
  const { source, target } = await availablePair();
  const booking = await createBooking('decline', source);
  const appointment = await loadAppointment(booking.email);
  const change = await requestCustomerChange(appointment, target, 'decline');

  const declined = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'decline', note: 'Please keep my original appointment.' }),
    expected: 200,
  });
  assert.equal(declined.body.action.status, 'declined');
  assert.equal(declined.body.replayed, false);

  const replay = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'decline' }),
    expected: 200,
  });
  assert.equal(replay.body.replayed, true);

  const opposite = await actionRequest(change.token, '/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve' }),
    expected: 409,
  });
  assert.equal(opposite.body.error.code, 'ACTION_ALREADY_COMPLETED');

  const stored = await storedState(booking.bookingId, appointment.id);
  assert.equal(new Date(stored.starts_at).toISOString(), source.startsAt);
  assert.equal(new Date(stored.widget_starts_at).toISOString(), source.startsAt);
  assert.equal(stored.slot_id, source.id);
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.change_status, 'declined');
  assert.equal(stored.token_decision, 'decline');
  assert(stored.used_at);
}

try {
  await approvalScenario();
  for (const bookingId of createdBookingIds) await cleanupBooking(bookingId);
  createdBookingIds.clear();

  await declineScenario();

  console.log(JSON.stringify({
    checks: [
      'raw approval token returned once and stored only as a SHA-256 hash',
      'pending change preview',
      'customer approval synchronizes administrator and widget bookings',
      'existing availability slot reused safely',
      'same-decision replay is idempotent',
      'opposite decision is rejected',
      'customer decline preserves the original appointment',
      'business and customer notification events queued',
    ],
  }, null, 2));
} finally {
  for (const bookingId of createdBookingIds) {
    await cleanupBooking(bookingId);
  }
  await pool.end();
}
