import { createHash, randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;
type ActionRow = Record<string, unknown>;

class CustomerActionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function requireToken(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 32
    || value.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new CustomerActionError(
      404,
      'ACTION_NOT_FOUND',
      'This approval link is not valid.',
    );
  }
  return value;
}

function requireDecision(value: unknown): 'approve' | 'decline' {
  if (value !== 'approve' && value !== 'decline') {
    throw new CustomerActionError(
      400,
      'INVALID_DECISION',
      'Choose approve or decline.',
    );
  }
  return value;
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 600) {
    throw new CustomerActionError(
      400,
      'INVALID_NOTE',
      'Your note must be 600 characters or fewer.',
    );
  }
  return value.trim() || null;
}

function asDate(value: unknown, field: string): Date {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new CustomerActionError(
      409,
      'INVALID_CHANGE',
      `The proposed ${field} is no longer valid.`,
    );
  }
  return date;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const actionSelect = `
  SELECT
    action.id AS token_id,
    action.organization_id,
    action.appointment_id,
    action.change_request_id,
    action.customer_id,
    action.expires_at,
    action.used_at,
    action.revoked_at,
    action.decision AS token_decision,
    change_request.status AS request_status,
    change_request.reason,
    change_request.proposed_changes,
    change_request.created_at AS requested_at,
    appointment.reference_code,
    appointment.starts_at,
    appointment.ends_at,
    appointment.time_zone,
    appointment.status AS appointment_status,
    appointment.version AS appointment_version,
    appointment.location_id,
    customer.display_name AS customer_name,
    customer.email AS customer_email,
    service.id AS service_id,
    service.name AS service_name,
    service.minimum_duration_minutes,
    service.maximum_duration_minutes,
    service.duration_increment_minutes,
    service.buffer_before_minutes,
    service.buffer_after_minutes,
    current_staff.id AS current_staff_id,
    current_staff.display_name AS current_staff_name,
    current_staff.email AS current_staff_email,
    current_location.name AS current_location_name,
    proposed_staff.id AS proposed_staff_id,
    proposed_staff.display_name AS proposed_staff_name,
    proposed_staff.email AS proposed_staff_email,
    proposed_location.id AS proposed_location_id,
    proposed_location.name AS proposed_location_name
  FROM chime_app.customer_action_tokens action
  JOIN chime_app.appointment_change_requests change_request
    ON change_request.organization_id = action.organization_id
   AND change_request.id = action.change_request_id
  JOIN chime_app.appointments appointment
    ON appointment.organization_id = action.organization_id
   AND appointment.id = action.appointment_id
  JOIN chime_app.customers customer
    ON customer.organization_id = action.organization_id
   AND customer.id = action.customer_id
  JOIN chime_app.services service
    ON service.organization_id = action.organization_id
   AND service.id = appointment.service_id
  LEFT JOIN LATERAL (
    SELECT assignment.staff_member_id
    FROM chime_app.appointment_staff assignment
    WHERE assignment.organization_id = appointment.organization_id
      AND assignment.appointment_id = appointment.id
      AND assignment.role = 'assigned'
    LIMIT 1
  ) current_assignment ON true
  LEFT JOIN chime_app.staff_members current_staff
    ON current_staff.organization_id = action.organization_id
   AND current_staff.id = current_assignment.staff_member_id
  LEFT JOIN chime_app.locations current_location
    ON current_location.organization_id = action.organization_id
   AND current_location.id = appointment.location_id
  LEFT JOIN chime_app.staff_members proposed_staff
    ON proposed_staff.organization_id = action.organization_id
   AND proposed_staff.id = NULLIF(change_request.proposed_changes->>'staffMemberId', '')::uuid
  LEFT JOIN chime_app.locations proposed_location
    ON proposed_location.organization_id = action.organization_id
   AND proposed_location.id = NULLIF(change_request.proposed_changes->>'locationId', '')::uuid
`;

async function loadAction(
  database: Queryable,
  hash: string,
  lock = false,
): Promise<ActionRow | null> {
  const result = await database.query(
    `${actionSelect}
     WHERE action.token_hash = $1
     ${lock ? 'FOR UPDATE OF action, change_request, appointment' : ''}`,
    [hash],
  );
  return result.rows[0] ? result.rows[0] as ActionRow : null;
}

function publicStatus(row: ActionRow): string {
  if (row.request_status === 'expired') return 'expired';
  if (row.request_status === 'withdrawn') return 'withdrawn';
  if (row.used_at) return row.token_decision === 'approve' ? 'approved' : 'declined';
  if (row.revoked_at) return 'unavailable';
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return 'expired';
  if (row.request_status === 'approved') return 'approved';
  if (row.request_status === 'declined') return 'declined';
  return 'pending';
}

function mapAction(row: ActionRow) {
  const proposed = (row.proposed_changes ?? {}) as Record<string, unknown>;
  const status = publicStatus(row);
  return {
    status,
    canDecide: status === 'pending',
    expiresAt: iso(row.expires_at),
    decidedAt: iso(row.used_at),
    decision: row.token_decision,
    referenceCode: row.reference_code,
    customerName: row.customer_name,
    serviceName: row.service_name,
    reason: row.reason,
    requestedAt: iso(row.requested_at),
    current: {
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      durationMinutes: Math.round(
        (
          new Date(String(row.ends_at)).getTime()
          - new Date(String(row.starts_at)).getTime()
        ) / 60_000,
      ),
      staffName: row.current_staff_name,
      locationName: row.current_location_name,
    },
    proposed: {
      startsAt: proposed.startsAt ?? null,
      endsAt: proposed.endsAt ?? null,
      durationMinutes: Number(proposed.durationMinutes ?? 0),
      staffName: row.proposed_staff_name,
      locationName: row.proposed_location_name,
    },
  };
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function expireAction(client: PoolClient, row: ActionRow) {
  await client.query(
    `UPDATE chime_app.customer_action_tokens
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1
       AND used_at IS NULL`,
    [row.token_id],
  );
  await client.query(
    `UPDATE chime_app.appointment_change_requests
     SET status = 'expired', resolved_at = now(), updated_at = now()
     WHERE organization_id = $1
       AND id = $2
       AND status = 'pending'`,
    [row.organization_id, row.change_request_id],
  );
  await client.query(
    `UPDATE chime_app.appointments
     SET status = 'confirmed', version = version + 1, updated_at = now()
     WHERE organization_id = $1
       AND id = $2
       AND status = 'change_pending'`,
    [row.organization_id, row.appointment_id],
  );
  await client.query(
    `INSERT INTO chime_app.in_app_notifications (
       organization_id,
       appointment_id,
       change_request_id,
       audience,
       kind,
       title,
       body,
       payload,
       dedupe_key
     ) VALUES (
       $1, $2, $3, 'business', 'appointment.change_expired',
       'Customer change request expired',
       $4, $5::jsonb, $6
     )
     ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
    [
      row.organization_id,
      row.appointment_id,
      row.change_request_id,
      `${row.customer_name} did not respond before the approval link expired.`,
      JSON.stringify({
        appointmentId: row.appointment_id,
        changeRequestId: row.change_request_id,
      }),
      `customer-action-expired:${row.token_id}`,
    ],
  );
}

async function conflictReason(
  client: PoolClient,
  row: ActionRow,
  proposed: Record<string, unknown>,
): Promise<string | null> {
  const startsAt = asDate(proposed.startsAt, 'start time');
  const endsAt = asDate(proposed.endsAt, 'end time');
  const staffMemberId = String(proposed.staffMemberId ?? '');
  const locationId = proposed.locationId ? String(proposed.locationId) : null;
  const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  const minimum = Number(row.minimum_duration_minutes);
  const maximum = Number(row.maximum_duration_minutes);
  const increment = Number(row.duration_increment_minutes);

  if (
    startsAt.getTime() <= Date.now()
    || endsAt <= startsAt
    || durationMinutes < minimum
    || durationMinutes > maximum
    || (durationMinutes - minimum) % increment !== 0
  ) {
    return 'The proposed time or duration is no longer valid.';
  }

  const staffAllowed = await client.query(
    `SELECT 1
     FROM chime_app.staff_members staff
     JOIN chime_app.service_staff service_staff
       ON service_staff.organization_id = staff.organization_id
      AND service_staff.staff_member_id = staff.id
     WHERE staff.organization_id = $1
       AND staff.id = $2
       AND service_staff.service_id = $3
       AND staff.is_active = true`,
    [row.organization_id, staffMemberId, row.service_id],
  );
  if (!staffAllowed.rowCount) {
    return 'The proposed team member is no longer available for this service.';
  }

  if (locationId) {
    const locationAllowed = await client.query(
      `SELECT 1
       FROM chime_app.locations location
       JOIN chime_app.service_locations service_location
         ON service_location.organization_id = location.organization_id
        AND service_location.location_id = location.id
       WHERE location.organization_id = $1
         AND location.id = $2
         AND service_location.service_id = $3
         AND location.is_active = true`,
      [row.organization_id, locationId, row.service_id],
    );
    if (!locationAllowed.rowCount) {
      return 'The proposed location is no longer available for this service.';
    }
  }

  const overlap = await client.query(
    `SELECT other.reference_code
     FROM chime_app.appointments other
     JOIN chime_app.appointment_staff assignment
       ON assignment.organization_id = other.organization_id
      AND assignment.appointment_id = other.id
      AND assignment.role = 'assigned'
     JOIN chime_app.services other_service
       ON other_service.organization_id = other.organization_id
      AND other_service.id = other.service_id
     WHERE other.organization_id = $1
       AND other.id <> $2
       AND assignment.staff_member_id = $3
       AND other.status IN ('pending_approval', 'confirmed', 'change_pending')
       AND tstzrange(
         other.starts_at - make_interval(mins => other_service.buffer_before_minutes),
         other.ends_at + make_interval(mins => other_service.buffer_after_minutes),
         '[)'
       ) && tstzrange(
         $4::timestamptz - make_interval(mins => $6),
         $5::timestamptz + make_interval(mins => $7),
         '[)'
       )
     LIMIT 1`,
    [
      row.organization_id,
      row.appointment_id,
      staffMemberId,
      startsAt.toISOString(),
      endsAt.toISOString(),
      row.buffer_before_minutes,
      row.buffer_after_minutes,
    ],
  );
  if (overlap.rowCount) {
    return 'That appointment time was just taken. The business has been asked to offer another option.';
  }

  return null;
}

async function recordConflict(
  client: PoolClient,
  row: ActionRow,
  message: string,
) {
  await client.query(
    `INSERT INTO chime_app.in_app_notifications (
       organization_id,
       appointment_id,
       change_request_id,
       audience,
       kind,
       title,
       body,
       payload,
       dedupe_key
     ) VALUES (
       $1, $2, $3, 'business', 'appointment.change_conflict',
       'Customer could not approve the proposed time',
       $4, $5::jsonb, $6
     )
     ON CONFLICT (organization_id, dedupe_key)
     DO UPDATE SET body = EXCLUDED.body, payload = EXCLUDED.payload,
       is_read = false, read_at = NULL`,
    [
      row.organization_id,
      row.appointment_id,
      row.change_request_id,
      message,
      JSON.stringify({
        appointmentId: row.appointment_id,
        changeRequestId: row.change_request_id,
        reason: message,
      }),
      `customer-action-conflict:${row.token_id}`,
    ],
  );
}

async function syncWidgetBooking(
  client: PoolClient,
  row: ActionRow,
  startsAt: Date,
  endsAt: Date,
  staffMemberId: string,
  locationId: string | null,
) {
  const linked = await client.query(
    `SELECT
       booking.id AS booking_id,
       booking.slot_id AS old_slot_id,
       booking.service_id AS public_service_id,
       old_slot.source AS old_slot_source
     FROM chime_app.widget_booking_links link
     JOIN public.chime_bookings booking
       ON booking.id = link.widget_booking_id
     JOIN public.chime_availability_slots old_slot
       ON old_slot.id = booking.slot_id
     WHERE link.organization_id = $1
       AND link.appointment_id = $2
     FOR UPDATE OF booking, old_slot`,
    [row.organization_id, row.appointment_id],
  );
  const booking = linked.rows[0];
  if (!booking) return;

  await client.query(
    'DELETE FROM public.chime_booking_assignments WHERE booking_id = $1',
    [booking.booking_id],
  );
  await client.query(
    `UPDATE public.chime_availability_slots
     SET booked_count = GREATEST(booked_count - 1, 0),
         status = CASE
           WHEN GREATEST(booked_count - 1, 0) < capacity THEN 'available'
           ELSE status
         END,
         updated_at = now()
     WHERE id = $1`,
    [booking.old_slot_id],
  );

  const slotResult = await client.query<{ id: string }>(
    `INSERT INTO public.chime_availability_slots AS existing (
       id, service_id, starts_at, ends_at, status, label,
       capacity, booked_count, organization_id, source
     ) VALUES (
       $1, $2, $3, $4, 'booked',
       'Customer-approved appointment change',
       1, 1, $5, 'customer-change'
     )
     ON CONFLICT (service_id, starts_at, ends_at) DO UPDATE
     SET booked_count = existing.booked_count + 1,
         status = CASE
           WHEN existing.booked_count + 1 >= existing.capacity THEN 'booked'
           ELSE 'available'
         END,
         organization_id = COALESCE(existing.organization_id, EXCLUDED.organization_id),
         updated_at = now()
     WHERE (existing.organization_id IS NULL
            OR existing.organization_id = EXCLUDED.organization_id)
       AND existing.booked_count < existing.capacity
     RETURNING id`,
    [
      randomUUID(),
      booking.public_service_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      row.organization_id,
    ],
  );
  const newSlotId = slotResult.rows[0]?.id;
  if (!newSlotId) {
    throw new CustomerActionError(
      409,
      'CHANGE_NO_LONGER_AVAILABLE',
      'That appointment time is no longer available. Your original appointment remains confirmed.',
    );
  }
  await client.query(
    `UPDATE public.chime_bookings
     SET slot_id = $1,
         appointment_date = ($2::timestamptz AT TIME ZONE $3)::date,
         time_label = to_char($2::timestamptz AT TIME ZONE $3, 'FMHH12:MI AM'),
         status = 'confirmed',
         updated_at = now()
     WHERE id = $4`,
    [newSlotId, startsAt.toISOString(), row.time_zone, booking.booking_id],
  );

  const busyStartsAt = new Date(
    startsAt.getTime() - Number(row.buffer_before_minutes) * 60_000,
  );
  const busyEndsAt = new Date(
    endsAt.getTime() + Number(row.buffer_after_minutes) * 60_000,
  );
  await client.query(
    `INSERT INTO public.chime_booking_assignments (
       booking_id, slot_id, organization_id, staff_member_id,
       location_id, busy_starts_at, busy_ends_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      booking.booking_id,
      newSlotId,
      row.organization_id,
      staffMemberId,
      locationId,
      busyStartsAt.toISOString(),
      busyEndsAt.toISOString(),
    ],
  );
  await client.query(
    'SELECT public.chime_refresh_generated_slot_capacities($1)',
    [row.organization_id],
  );
  if (booking.old_slot_source === 'customer-change') {
    await client.query(
      `DELETE FROM public.chime_availability_slots old_slot
       WHERE old_slot.id = $1
         AND old_slot.booked_count = 0
         AND NOT EXISTS (
           SELECT 1 FROM public.chime_bookings other_booking
           WHERE other_booking.slot_id = old_slot.id
         )`,
      [booking.old_slot_id],
    );
  }
}

async function applyApprovedChange(
  client: PoolClient,
  row: ActionRow,
  proposed: Record<string, unknown>,
) {
  const startsAt = asDate(proposed.startsAt, 'start time');
  const endsAt = asDate(proposed.endsAt, 'end time');
  const staffMemberId = String(proposed.staffMemberId);
  const locationId = proposed.locationId ? String(proposed.locationId) : null;

  await syncWidgetBooking(
    client,
    row,
    startsAt,
    endsAt,
    staffMemberId,
    locationId,
  );
  await client.query(
    `DELETE FROM chime_app.appointment_staff
     WHERE organization_id = $1
       AND appointment_id = $2
       AND role = 'assigned'`,
    [row.organization_id, row.appointment_id],
  );
  await client.query(
    `INSERT INTO chime_app.appointment_staff (
       organization_id, appointment_id, staff_member_id, role
     ) VALUES ($1, $2, $3, 'assigned')`,
    [row.organization_id, row.appointment_id, staffMemberId],
  );
  await client.query(
    `DELETE FROM chime_app.appointment_participants
     WHERE organization_id = $1
       AND appointment_id = $2
       AND participant_kind = 'staff'`,
    [row.organization_id, row.appointment_id],
  );
  await client.query(
    `INSERT INTO chime_app.appointment_participants (
       id, organization_id, appointment_id, staff_member_id,
       participant_kind, display_name, email, notification_preference
     )
     SELECT $1, $2, $3, staff.id, 'staff',
       staff.display_name, staff.email, 'email'
     FROM chime_app.staff_members staff
     WHERE staff.organization_id = $2
       AND staff.id = $4`,
    [randomUUID(), row.organization_id, row.appointment_id, staffMemberId],
  );
  await client.query(
    `UPDATE chime_app.appointments
     SET starts_at = $1,
         ends_at = $2,
         location_id = $3,
         status = 'confirmed',
         version = version + 1,
         updated_at = now()
     WHERE organization_id = $4
       AND id = $5`,
    [
      startsAt.toISOString(),
      endsAt.toISOString(),
      locationId,
      row.organization_id,
      row.appointment_id,
    ],
  );
}

async function writeDecisionRecords(
  client: PoolClient,
  row: ActionRow,
  decision: 'approve' | 'decline',
  note: string | null,
) {
  await client.query(
    `UPDATE chime_app.appointment_change_requests
     SET status = $1, resolved_at = now(), updated_at = now()
     WHERE organization_id = $2
       AND id = $3`,
    [
      decision === 'approve' ? 'approved' : 'declined',
      row.organization_id,
      row.change_request_id,
    ],
  );
  if (decision === 'decline') {
    await client.query(
      `UPDATE chime_app.appointments
       SET status = 'confirmed', version = version + 1, updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [row.organization_id, row.appointment_id],
    );
  }
  await client.query(
    `INSERT INTO chime_app.appointment_change_decisions (
       id, organization_id, change_request_id, decision,
       decided_by_kind, decided_by_customer_id, note
     ) VALUES ($1, $2, $3, $4, 'customer', $5, $6)`,
    [
      randomUUID(),
      row.organization_id,
      row.change_request_id,
      decision,
      row.customer_id,
      note,
    ],
  );
  await client.query(
    `UPDATE chime_app.customer_action_tokens
     SET used_at = now(), decision = $1
     WHERE id = $2`,
    [decision, row.token_id],
  );
}

async function notifyDecision(
  client: PoolClient,
  row: ActionRow,
  decision: 'approve' | 'decline',
  note: string | null,
) {
  const eventId = randomUUID();
  const eventKey = `customer-change-decision:${row.token_id}`;
  const eventType = decision === 'approve'
    ? 'appointment.change_approved'
    : 'appointment.change_declined';
  const title = decision === 'approve'
    ? 'Customer approved the appointment change'
    : 'Customer declined the appointment change';
  const body = decision === 'approve'
    ? `${row.customer_name} approved the new time for ${row.service_name}.`
    : `${row.customer_name} kept the original time for ${row.service_name}.`;

  await client.query(
    `INSERT INTO chime_app.audit_events (
       organization_id, actor_kind, actor_id, action, entity_type,
       entity_id, before_state, after_state, correlation_id
     ) VALUES (
       $1, 'customer', $2, $3, 'appointment', $4,
       $5::jsonb, $6::jsonb, $7
     )`,
    [
      row.organization_id,
      row.customer_id,
      eventType,
      row.appointment_id,
      JSON.stringify({
        status: row.appointment_status,
        version: row.appointment_version,
      }),
      JSON.stringify({
        status: 'confirmed',
        version: Number(row.appointment_version) + 1,
        decision,
        changeRequestId: row.change_request_id,
        note,
      }),
      eventKey,
    ],
  );
  await client.query(
    `INSERT INTO chime_app.outbox_events (
       id, organization_id, event_type, aggregate_type,
       aggregate_id, payload, idempotency_key
     ) VALUES ($1, $2, $3, 'appointment', $4, $5::jsonb, $6)
     ON CONFLICT DO NOTHING`,
    [
      eventId,
      row.organization_id,
      eventType,
      row.appointment_id,
      JSON.stringify({
        appointmentId: row.appointment_id,
        changeRequestId: row.change_request_id,
        customerId: row.customer_id,
        decision,
        note,
      }),
      eventKey,
    ],
  );
  await client.query(
    `INSERT INTO chime_app.in_app_notifications (
       organization_id, appointment_id, change_request_id, audience,
       kind, title, body, payload, dedupe_key
     ) VALUES ($1, $2, $3, 'business', $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
    [
      row.organization_id,
      row.appointment_id,
      row.change_request_id,
      eventType,
      title,
      body,
      JSON.stringify({
        appointmentId: row.appointment_id,
        changeRequestId: row.change_request_id,
        decision,
      }),
      eventKey,
    ],
  );

  const recipients = [
    {
      recipient: row.customer_email,
      template: `appointment_change_${decision}d_customer`,
      key: 'customer',
    },
    {
      recipient: decision === 'approve'
        ? row.proposed_staff_email
        : row.current_staff_email,
      template: `appointment_change_${decision}d_staff`,
      key: 'staff',
    },
  ].filter((delivery) => delivery.recipient);
  for (const delivery of recipients) {
    await client.query(
      `INSERT INTO chime_app.notification_deliveries (
         organization_id, outbox_event_id, channel, recipient,
         template_key, idempotency_key
       ) VALUES ($1, $2, 'email', $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        row.organization_id,
        eventId,
        delivery.recipient,
        delivery.template,
        `${eventKey}:${delivery.key}:email`,
      ],
    );
  }
}

async function decideAction(
  pool: Pool,
  hash: string,
  decision: 'approve' | 'decline',
  note: string | null,
) {
  return withTransaction(pool, async (client) => {
    const row = await loadAction(client, hash, true);
    if (!row) {
      throw new CustomerActionError(
        404,
        'ACTION_NOT_FOUND',
        'This approval link is not valid.',
      );
    }
    if (row.used_at) {
      if (row.token_decision !== decision) {
        throw new CustomerActionError(
          409,
          'ACTION_ALREADY_COMPLETED',
          'This link has already been used for a different decision.',
        );
      }
      return { action: mapAction(row), replayed: true };
    }
    if (row.revoked_at || row.request_status !== 'pending') {
      throw new CustomerActionError(
        410,
        'ACTION_UNAVAILABLE',
        'This change request is no longer available.',
      );
    }
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await expireAction(client, row);
      return {
        expired: true,
        message: 'This approval link has expired. The original appointment remains confirmed.',
      };
    }

    const proposed = (row.proposed_changes ?? {}) as Record<string, unknown>;
    if (decision === 'approve') {
      const conflict = await conflictReason(client, row, proposed);
      if (conflict) {
        await recordConflict(client, row, conflict);
        return { conflict: true, message: conflict };
      }
      await applyApprovedChange(client, row, proposed);
    }

    await writeDecisionRecords(client, row, decision, note);
    await notifyDecision(client, row, decision, note);
    const updated = await loadAction(client, hash);
    if (!updated) {
      throw new CustomerActionError(
        500,
        'ACTION_REFRESH_FAILED',
        'The decision was saved but could not be reloaded.',
      );
    }
    return { action: mapAction(updated), replayed: false };
  });
}

export function createCustomerApprovalRouter(pool: Pool) {
  const router = Router();

  router.get('/:token', asyncRoute(async (request, response) => {
    const hash = tokenHash(requireToken(request.params.token));
    let row = await loadAction(pool, hash);
    if (!row) {
      throw new CustomerActionError(
        404,
        'ACTION_NOT_FOUND',
        'This approval link is not valid.',
      );
    }
    if (
      !row.used_at
      && !row.revoked_at
      && row.request_status === 'pending'
      && new Date(String(row.expires_at)).getTime() <= Date.now()
    ) {
      await withTransaction(pool, async (client) => {
        const locked = await loadAction(client, hash, true);
        if (
          locked
          && !locked.used_at
          && !locked.revoked_at
          && locked.request_status === 'pending'
          && new Date(String(locked.expires_at)).getTime() <= Date.now()
        ) {
          await expireAction(client, locked);
        }
      });
      row = await loadAction(pool, hash);
    }
    if (!row) {
      throw new CustomerActionError(
        404,
        'ACTION_NOT_FOUND',
        'This approval link is not valid.',
      );
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json({ action: mapAction(row) });
  }));

  router.post('/:token/decision', asyncRoute(async (request, response) => {
    const hash = tokenHash(requireToken(request.params.token));
    const decision = requireDecision(request.body?.decision);
    const result = await decideAction(
      pool,
      hash,
      decision,
      optionalNote(request.body?.note),
    );
    response.setHeader('Cache-Control', 'no-store');
    if ('conflict' in result && result.conflict) {
      response.status(409).json({
        error: { code: 'CHANGE_NO_LONGER_AVAILABLE', message: result.message },
      });
      return;
    }
    if ('expired' in result && result.expired) {
      response.status(410).json({
        error: { code: 'ACTION_EXPIRED', message: result.message },
      });
      return;
    }
    response.json(result);
  }));

  router.use((
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (error instanceof CustomerActionError) {
      response.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    next(error);
  });

  return router;
}
