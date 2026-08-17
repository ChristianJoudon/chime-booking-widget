import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Pool, PoolClient } from 'pg';
import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import {
  parseExpectedVersion,
  parseUuid,
  requireIdempotencyKey,
} from './validation.js';

type Queryable = Pool | PoolClient;

type MutationContext = {
  organizationId: string;
  userId: string;
  requestId: string;
  idempotencyKey: string;
};

type ProposedChangeInput = {
  startsAt: Date;
  durationMinutes: number;
  staffMemberId: string;
  locationId: string | null;
  reason: string;
};

function createCustomerActionToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

function customerApprovalUrl(token: string): string {
  const baseUrl = process.env.CHIME_CUSTOMER_APPROVAL_URL
    ?? 'http://127.0.0.1:4375/approval.html';
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}

function customerActionExpiry(): Date {
  const configuredHours = Number(process.env.CHIME_CUSTOMER_ACTION_TTL_HOURS ?? 168);
  const hours = Number.isFinite(configuredHours)
    ? Math.min(720, Math.max(1, configuredHours))
    : 168;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function mutationContext(request: Request): MutationContext {
  const session = getAdminSession(request);
  return {
    organizationId: session.organizationId,
    userId: session.subject,
    requestId: request.chimeRequestId ?? randomUUID(),
    idempotencyKey: requireIdempotencyKey(request.get('idempotency-key')),
  };
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new AdminApiError(400, 'INVALID_DATE', `${field} must be an ISO date and time.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AdminApiError(400, 'INVALID_DATE', `${field} must be a valid date and time.`);
  }
  return date;
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new AdminApiError(400, 'INVALID_NUMBER', `${field} must be a positive whole number.`);
  }
  return Number(value);
}

function requireText(value: unknown, field: string, maxLength = 600): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AdminApiError(400, 'INVALID_TEXT', `${field} is required.`);
  }
  if (value.trim().length > maxLength) {
    throw new AdminApiError(400, 'INVALID_TEXT', `${field} is too long.`);
  }
  return value.trim();
}

function parseOptionalUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminApiError(400, 'INVALID_ID', `${field} must be a UUID.`);
  }
  return parseUuid(value, field);
}

function parseChangeInput(value: unknown): ProposedChangeInput {
  if (!value || typeof value !== 'object') {
    throw new AdminApiError(400, 'INVALID_CHANGE', 'Appointment changes are required.');
  }
  const input = value as Record<string, unknown>;
  return {
    startsAt: parseDate(input.startsAt, 'startsAt'),
    durationMinutes: parsePositiveInteger(input.durationMinutes, 'durationMinutes'),
    staffMemberId: parseUuid(String(input.staffMemberId ?? ''), 'staffMemberId'),
    locationId: parseOptionalUuid(input.locationId, 'locationId'),
    reason: requireText(input.reason, 'reason'),
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapAppointment(row: Record<string, unknown>) {
  if (!row.id) {
    throw new AdminApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment was not found.');
  }
  return {
    id: row.id,
    referenceCode: row.reference_code,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    timeZone: row.time_zone,
    status: row.status,
    source: row.source,
    confirmationMode: row.confirmation_mode,
    changeApprovalMode: row.change_approval_mode,
    customerNotes: row.customer_notes,
    internalNotes: row.internal_notes,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    service: {
      id: row.service_id,
      name: row.service_name,
      durationMinutes: row.default_duration_minutes,
      minimumDurationMinutes: row.minimum_duration_minutes,
      maximumDurationMinutes: row.maximum_duration_minutes,
      durationIncrementMinutes: row.duration_increment_minutes,
      bufferBeforeMinutes: row.buffer_before_minutes,
      bufferAfterMinutes: row.buffer_after_minutes,
    },
    staff: row.staff_member_id
      ? {
          id: row.staff_member_id,
          name: row.staff_name,
          email: row.staff_email,
          color: row.staff_color,
        }
      : null,
    location: row.location_id
      ? {
          id: row.location_id,
          name: row.location_name,
          timeZone: row.location_time_zone,
        }
      : null,
    widgetBookingId: row.widget_booking_id,
    pendingChange: row.change_request_id
      ? {
          id: row.change_request_id,
          requestedByKind: row.change_requested_by_kind,
          requestedByUserId: row.change_requested_by_user_id,
          proposedChanges: row.proposed_changes ?? {},
          reason: row.change_reason,
          status: row.change_status,
          createdAt: iso(row.change_created_at),
        }
      : null,
  };
}

const appointmentSelect = `
  SELECT
    appointment.*,
    customer.display_name AS customer_name,
    customer.email AS customer_email,
    customer.phone AS customer_phone,
    service.name AS service_name,
    service.default_duration_minutes,
    service.minimum_duration_minutes,
    service.maximum_duration_minutes,
    service.duration_increment_minutes,
    service.buffer_before_minutes,
    service.buffer_after_minutes,
    staff.id AS staff_member_id,
    staff.display_name AS staff_name,
    staff.email AS staff_email,
    staff.color AS staff_color,
    location.name AS location_name,
    location.time_zone AS location_time_zone,
    widget_link.widget_booking_id,
    pending_change.id AS change_request_id,
    pending_change.requested_by_kind AS change_requested_by_kind,
    pending_change.requested_by_user_id AS change_requested_by_user_id,
    pending_change.proposed_changes,
    pending_change.reason AS change_reason,
    pending_change.status AS change_status,
    pending_change.created_at AS change_created_at
  FROM chime_app.appointments appointment
  JOIN chime_app.customers customer
    ON customer.id = appointment.customer_id
   AND customer.organization_id = appointment.organization_id
  JOIN chime_app.services service
    ON service.id = appointment.service_id
   AND service.organization_id = appointment.organization_id
  LEFT JOIN chime_app.locations location
    ON location.id = appointment.location_id
   AND location.organization_id = appointment.organization_id
  LEFT JOIN LATERAL (
    SELECT assignment.staff_member_id
    FROM chime_app.appointment_staff assignment
    WHERE assignment.organization_id = appointment.organization_id
      AND assignment.appointment_id = appointment.id
      AND assignment.role = 'assigned'
    ORDER BY assignment.staff_member_id
    LIMIT 1
  ) assigned ON true
  LEFT JOIN chime_app.staff_members staff
    ON staff.id = assigned.staff_member_id
   AND staff.organization_id = appointment.organization_id
  LEFT JOIN chime_app.widget_booking_links widget_link
    ON widget_link.organization_id = appointment.organization_id
   AND widget_link.appointment_id = appointment.id
  LEFT JOIN LATERAL (
    SELECT request.*
    FROM chime_app.appointment_change_requests request
    WHERE request.organization_id = appointment.organization_id
      AND request.appointment_id = appointment.id
      AND request.status = 'pending'
    ORDER BY request.created_at DESC
    LIMIT 1
  ) pending_change ON true
`;

async function getAppointment(
  database: Queryable,
  organizationId: string,
  appointmentId: string,
) {
  const result = await database.query(
    `${appointmentSelect}
     WHERE appointment.organization_id = $1
       AND appointment.id = $2`,
    [organizationId, appointmentId],
  );
  return mapAppointment(result.rows[0] as Record<string, unknown>);
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

async function writeEvent(
  client: PoolClient,
  context: MutationContext,
  eventType: string,
  appointmentId: string,
  payload: Record<string, unknown>,
  recipient: string | null,
  templateKey: string,
) {
  const inserted = await client.query(
    `INSERT INTO chime_app.outbox_events (
       organization_id,
       event_type,
       aggregate_type,
       aggregate_id,
       payload,
       idempotency_key
     ) VALUES ($1, $2, 'appointment', $3, $4::jsonb, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      context.organizationId,
      eventType,
      appointmentId,
      JSON.stringify(payload),
      context.idempotencyKey,
    ],
  );

  let outboxId = inserted.rows[0]?.id as string | undefined;
  if (!outboxId) {
    const existing = await client.query(
      `SELECT id
       FROM chime_app.outbox_events
       WHERE organization_id = $1
         AND idempotency_key = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [context.organizationId, context.idempotencyKey],
    );
    outboxId = existing.rows[0]?.id;
  }

  if (outboxId && recipient) {
    await client.query(
      `INSERT INTO chime_app.notification_deliveries (
         organization_id,
         outbox_event_id,
         channel,
         recipient,
         template_key,
         idempotency_key
       ) VALUES ($1, $2, 'email', $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        context.organizationId,
        outboxId,
        recipient,
        templateKey,
        `${context.idempotencyKey}:email`,
      ],
    );
  }
}

async function writeAudit(
  client: PoolClient,
  context: MutationContext,
  action: string,
  appointmentId: string,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO chime_app.audit_events (
       organization_id,
       actor_kind,
       actor_id,
       action,
       entity_type,
       entity_id,
       before_state,
       after_state,
       correlation_id
     ) VALUES ($1, 'user', $2, $3, 'appointment', $4, $5::jsonb, $6::jsonb, $7)`,
    [
      context.organizationId,
      context.userId,
      action,
      appointmentId,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      context.requestId,
    ],
  );
}

async function listOperations(
  pool: Pool,
  organizationId: string,
  startsAt: Date,
  endsAt: Date,
) {
  const [appointments, staff, locations, notifications] = await Promise.all([
    pool.query(
      `${appointmentSelect}
       WHERE appointment.organization_id = $1
         AND appointment.starts_at < $3
         AND appointment.ends_at > $2
         AND appointment.status NOT IN ('draft', 'expired')
       ORDER BY appointment.starts_at, appointment.reference_code`,
      [organizationId, startsAt.toISOString(), endsAt.toISOString()],
    ),
    pool.query(
      `SELECT
         staff.id,
         staff.display_name,
         staff.email,
         staff.color,
         staff.is_active
       FROM chime_app.staff_members staff
       WHERE staff.organization_id = $1
       ORDER BY staff.is_active DESC, staff.display_name`,
      [organizationId],
    ),
    pool.query(
      `SELECT id, name, time_zone, is_active
       FROM chime_app.locations
       WHERE organization_id = $1
       ORDER BY is_active DESC, name`,
      [organizationId],
    ),
    pool.query(
      `SELECT
         notification.id,
         notification.appointment_id,
         notification.change_request_id,
         notification.kind,
         notification.title,
         notification.body,
         notification.payload,
         notification.is_read,
         notification.read_at,
         notification.created_at
       FROM chime_app.in_app_notifications notification
       WHERE notification.organization_id = $1
         AND notification.audience = 'business'
       ORDER BY notification.created_at DESC
       LIMIT 80`,
      [organizationId],
    ),
  ]);

  return {
    appointments: appointments.rows.map((row) =>
      mapAppointment(row as Record<string, unknown>),
    ),
    staff: staff.rows.map((row) => ({
      id: row.id,
      name: row.display_name,
      email: row.email,
      color: row.color,
      isActive: row.is_active,
    })),
    locations: locations.rows.map((row) => ({
      id: row.id,
      name: row.name,
      timeZone: row.time_zone,
      isActive: row.is_active,
    })),
    notifications: notifications.rows.map((row) => ({
      id: row.id,
      appointmentId: row.appointment_id,
      changeRequestId: row.change_request_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      payload: row.payload,
      isRead: row.is_read,
      readAt: iso(row.read_at),
      createdAt: iso(row.created_at),
    })),
  };
}

async function decideAppointment(
  pool: Pool,
  appointmentId: string,
  expectedVersion: number,
  decision: 'approve' | 'decline',
  note: string | null,
  context: MutationContext,
) {
  return withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT
         appointment.*,
         customer.email AS customer_email,
         customer.display_name AS customer_name,
         service.name AS service_name,
         link.widget_booking_id
       FROM chime_app.appointments appointment
       JOIN chime_app.customers customer
         ON customer.id = appointment.customer_id
        AND customer.organization_id = appointment.organization_id
       JOIN chime_app.services service
         ON service.id = appointment.service_id
        AND service.organization_id = appointment.organization_id
       LEFT JOIN chime_app.widget_booking_links link
         ON link.organization_id = appointment.organization_id
        AND link.appointment_id = appointment.id
       WHERE appointment.organization_id = $1
         AND appointment.id = $2
       FOR UPDATE OF appointment`,
      [context.organizationId, appointmentId],
    );
    const appointment = locked.rows[0];
    if (!appointment) {
      throw new AdminApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment was not found.');
    }
    if (appointment.version !== expectedVersion) {
      throw new AdminApiError(
        409,
        'VERSION_CONFLICT',
        'This appointment changed while you were viewing it. Refresh and try again.',
      );
    }
    if (appointment.status !== 'pending_approval') {
      throw new AdminApiError(
        409,
        'DECISION_NOT_AVAILABLE',
        'This appointment no longer needs an approval decision.',
      );
    }

    const nextStatus = decision === 'approve' ? 'confirmed' : 'declined';
    if (appointment.widget_booking_id) {
      await client.query(
        `UPDATE public.chime_bookings
         SET status = $1, updated_at = now()
         WHERE id = $2`,
        [decision === 'approve' ? 'confirmed' : 'cancelled', appointment.widget_booking_id],
      );
    }

    await client.query(
      `UPDATE chime_app.appointments
       SET status = $1,
           internal_notes = CASE
             WHEN $2::text IS NULL THEN internal_notes
             WHEN internal_notes IS NULL OR internal_notes = '' THEN $2
             ELSE internal_notes || E'\\n' || $2
           END,
           cancelled_at = CASE WHEN $1 = 'declined' THEN now() ELSE cancelled_at END,
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $3
         AND id = $4`,
      [nextStatus, note, context.organizationId, appointmentId],
    );

    await writeAudit(
      client,
      context,
      `appointment.${decision}d`,
      appointmentId,
      { status: appointment.status, version: appointment.version },
      { status: nextStatus, version: appointment.version + 1, note },
    );
    await writeEvent(
      client,
      context,
      `appointment.${decision}d`,
      appointmentId,
      {
        appointmentId,
        decision,
        note,
        startsAt: iso(appointment.starts_at),
        serviceName: appointment.service_name,
      },
      appointment.customer_email,
      decision === 'approve' ? 'booking_approved' : 'booking_declined',
    );

    await client.query(
      `INSERT INTO chime_app.in_app_notifications (
         organization_id,
         appointment_id,
         audience,
         recipient_customer_id,
         kind,
         title,
         body,
         payload,
         dedupe_key
       ) VALUES ($1, $2, 'customer', $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
      [
        context.organizationId,
        appointmentId,
        appointment.customer_id,
        `booking.${decision}d`,
        decision === 'approve' ? 'Your appointment is approved' : 'Your appointment was declined',
        decision === 'approve'
          ? `${appointment.service_name} is confirmed.`
          : `${appointment.service_name} could not be approved.`,
        JSON.stringify({ appointmentId, decision, note }),
        `${context.idempotencyKey}:customer-in-app`,
      ],
    );

    return getAppointment(client, context.organizationId, appointmentId);
  });
}

/**
 * Finds appointments that would collide with a proposed time for one staff
 * member, counting the buffers required on both sides.
 *
 * Extracted so the same query answers two questions: the check the studio makes
 * while an administrator is still choosing a time, and the guard that refuses
 * the write. A separate implementation for the preview would eventually drift
 * from the one that actually enforces, and the preview would start lying.
 */
async function findScheduleConflicts(
  executor: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  params: {
    organizationId: string;
    appointmentId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
  },
): Promise<Array<{ referenceCode: string; startsAt: string; endsAt: string; customerName: string }>> {
  const result = await executor.query<{
    reference_code: string;
    starts_at: Date;
    ends_at: Date;
    customer_name: string;
  }>(
    `SELECT other.reference_code, other.starts_at, other.ends_at,
            customer.display_name AS customer_name
       FROM chime_app.appointments other
       JOIN chime_app.appointment_staff other_assignment
         ON other_assignment.organization_id = other.organization_id
        AND other_assignment.appointment_id = other.id
        AND other_assignment.role = 'assigned'
       JOIN chime_app.services other_service
         ON other_service.organization_id = other.organization_id
        AND other_service.id = other.service_id
       JOIN chime_app.customers customer
         ON customer.organization_id = other.organization_id
        AND customer.id = other.customer_id
      WHERE other.organization_id = $1
        AND other.id <> $2
        AND other_assignment.staff_member_id = $3
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
      ORDER BY other.starts_at
      LIMIT 5`,
    [
      params.organizationId,
      params.appointmentId,
      params.staffMemberId,
      params.startsAt.toISOString(),
      params.endsAt.toISOString(),
      params.bufferBeforeMinutes,
      params.bufferAfterMinutes,
    ],
  );
  return result.rows.map((row) => ({
    referenceCode: row.reference_code,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    customerName: row.customer_name,
  }));
}

async function requestChange(
  pool: Pool,
  appointmentId: string,
  expectedVersion: number,
  input: ProposedChangeInput,
  context: MutationContext,
) {
  return withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT
         appointment.*,
         customer.email AS customer_email,
         service.name AS service_name,
         service.minimum_duration_minutes,
         service.maximum_duration_minutes,
         service.duration_increment_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes
       FROM chime_app.appointments appointment
       JOIN chime_app.customers customer
         ON customer.id = appointment.customer_id
        AND customer.organization_id = appointment.organization_id
       JOIN chime_app.services service
         ON service.id = appointment.service_id
        AND service.organization_id = appointment.organization_id
       WHERE appointment.organization_id = $1
         AND appointment.id = $2
       FOR UPDATE OF appointment`,
      [context.organizationId, appointmentId],
    );
    const appointment = locked.rows[0];
    if (!appointment) {
      throw new AdminApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment was not found.');
    }
    if (appointment.version !== expectedVersion) {
      throw new AdminApiError(
        409,
        'VERSION_CONFLICT',
        'This appointment changed while you were viewing it. Refresh and try again.',
      );
    }
    if (appointment.status !== 'confirmed') {
      throw new AdminApiError(
        409,
        'CHANGE_NOT_AVAILABLE',
        'Only confirmed appointments can be adjusted.',
      );
    }
    if (input.startsAt.getTime() <= Date.now()) {
      throw new AdminApiError(
        400,
        'PAST_APPOINTMENT',
        'Choose a future appointment time.',
      );
    }

    const minimum = Number(appointment.minimum_duration_minutes);
    const maximum = Number(appointment.maximum_duration_minutes);
    const increment = Number(appointment.duration_increment_minutes);
    if (
      input.durationMinutes < minimum
      || input.durationMinutes > maximum
      || (input.durationMinutes - minimum) % increment !== 0
    ) {
      throw new AdminApiError(
        400,
        'INVALID_DURATION',
        `Duration must be ${minimum}-${maximum} minutes in ${increment}-minute steps.`,
      );
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
      [context.organizationId, input.staffMemberId, appointment.service_id],
    );
    if (staffAllowed.rowCount === 0) {
      throw new AdminApiError(
        400,
        'STAFF_NOT_AVAILABLE',
        'That team member is not available for this service.',
      );
    }

    if (input.locationId) {
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
        [context.organizationId, input.locationId, appointment.service_id],
      );
      if (locationAllowed.rowCount === 0) {
        throw new AdminApiError(
          400,
          'LOCATION_NOT_AVAILABLE',
          'That location is not available for this service.',
        );
      }
    }

    const endsAt = new Date(
      input.startsAt.getTime() + input.durationMinutes * 60_000,
    );
    const conflicts = await findScheduleConflicts(client, {
      organizationId: context.organizationId,
      appointmentId,
      staffMemberId: input.staffMemberId,
      startsAt: input.startsAt,
      endsAt,
      bufferBeforeMinutes: appointment.buffer_before_minutes,
      bufferAfterMinutes: appointment.buffer_after_minutes,
    });
    if (conflicts.length) {
      throw new AdminApiError(
        409,
        'APPOINTMENT_OVERLAP',
        `That team member already has ${conflicts[0].referenceCode} during this time.`,
        { conflicts },
      );
    }

    const existing = await client.query(
      `SELECT id
       FROM chime_app.appointment_change_requests
       WHERE organization_id = $1
         AND appointment_id = $2
         AND status = 'pending'
       LIMIT 1`,
      [context.organizationId, appointmentId],
    );
    if (existing.rowCount) {
      throw new AdminApiError(
        409,
        'CHANGE_ALREADY_PENDING',
        'This appointment already has a pending change.',
      );
    }

    const requestId = randomUUID();
    const customerAction = createCustomerActionToken();
    const approvalUrl = customerApprovalUrl(customerAction.token);
    const actionExpiresAt = customerActionExpiry();
    const proposedChanges = {
      startsAt: input.startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      durationMinutes: input.durationMinutes,
      staffMemberId: input.staffMemberId,
      locationId: input.locationId,
    };
    await client.query(
      `INSERT INTO chime_app.appointment_change_requests (
         id,
         organization_id,
         appointment_id,
         base_appointment_version,
         requested_by_kind,
         requested_by_user_id,
         proposed_changes,
         reason,
         status
       ) VALUES ($1, $2, $3, $4, 'user', $5, $6::jsonb, $7, 'pending')`,
      [
        requestId,
        context.organizationId,
        appointmentId,
        appointment.version,
        context.userId,
        JSON.stringify(proposedChanges),
        input.reason,
      ],
    );
    await client.query(
      `INSERT INTO chime_app.customer_action_tokens (
         id,
         organization_id,
         appointment_id,
         change_request_id,
         customer_id,
         purpose,
         token_hash,
         expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'change_decision', $6, $7)`,
      [
        randomUUID(),
        context.organizationId,
        appointmentId,
        requestId,
        appointment.customer_id,
        customerAction.tokenHash,
        actionExpiresAt.toISOString(),
      ],
    );
    await client.query(
      `UPDATE chime_app.appointments
       SET status = 'change_pending',
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [context.organizationId, appointmentId],
    );

    await writeAudit(
      client,
      context,
      'appointment.change_requested',
      appointmentId,
      {
        status: appointment.status,
        version: appointment.version,
        startsAt: iso(appointment.starts_at),
        endsAt: iso(appointment.ends_at),
      },
      {
        status: 'change_pending',
        version: appointment.version + 1,
        changeRequestId: requestId,
        proposedChanges,
      },
    );
    await writeEvent(
      client,
      context,
      'appointment.change_requested',
      appointmentId,
      {
        appointmentId,
        changeRequestId: requestId,
        proposedChanges,
        reason: input.reason,
        approvalUrl,
        expiresAt: actionExpiresAt.toISOString(),
      },
      appointment.customer_email,
      'appointment_change_requested',
    );
    await client.query(
      `INSERT INTO chime_app.in_app_notifications (
         organization_id,
         appointment_id,
         change_request_id,
         audience,
         recipient_customer_id,
         kind,
         title,
         body,
         payload,
         dedupe_key
       ) VALUES ($1, $2, $3, 'customer', $4, 'appointment.change_requested',
         'An appointment change needs your approval',
         $5,
         $6::jsonb,
         $7)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
      [
        context.organizationId,
        appointmentId,
        requestId,
        appointment.customer_id,
        `${appointment.service_name} has a proposed new time.`,
        JSON.stringify({
          appointmentId,
          changeRequestId: requestId,
          proposedChanges,
          approvalUrl,
          expiresAt: actionExpiresAt.toISOString(),
        }),
        `${context.idempotencyKey}:customer-in-app`,
      ],
    );

    return {
      appointment: await getAppointment(client, context.organizationId, appointmentId),
      customerAction: {
        approvalUrl,
        expiresAt: actionExpiresAt.toISOString(),
      },
    };
  });
}

async function withdrawChange(
  pool: Pool,
  appointmentId: string,
  changeRequestId: string,
  expectedVersion: number,
  context: MutationContext,
) {
  return withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT
         appointment.version,
         appointment.customer_id,
         customer.email AS customer_email,
         request.requested_by_kind,
         request.requested_by_user_id,
         request.status AS request_status
       FROM chime_app.appointments appointment
       JOIN chime_app.customers customer
         ON customer.id = appointment.customer_id
        AND customer.organization_id = appointment.organization_id
       JOIN chime_app.appointment_change_requests request
         ON request.organization_id = appointment.organization_id
        AND request.appointment_id = appointment.id
       WHERE appointment.organization_id = $1
         AND appointment.id = $2
         AND request.id = $3
       FOR UPDATE OF appointment, request`,
      [context.organizationId, appointmentId, changeRequestId],
    );
    const change = locked.rows[0];
    if (!change) {
      throw new AdminApiError(404, 'CHANGE_NOT_FOUND', 'Change request was not found.');
    }
    if (change.version !== expectedVersion) {
      throw new AdminApiError(
        409,
        'VERSION_CONFLICT',
        'This appointment changed while you were viewing it. Refresh and try again.',
      );
    }
    if (
      change.request_status !== 'pending'
      || change.requested_by_kind !== 'user'
      || change.requested_by_user_id !== context.userId
    ) {
      throw new AdminApiError(
        409,
        'WITHDRAW_NOT_AVAILABLE',
        'This change can no longer be withdrawn by this user.',
      );
    }

    await client.query(
      `UPDATE chime_app.appointment_change_requests
       SET status = 'withdrawn', resolved_at = now(), updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [context.organizationId, changeRequestId],
    );
    await client.query(
      `UPDATE chime_app.customer_action_tokens
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE organization_id = $1
         AND change_request_id = $2
         AND used_at IS NULL`,
      [context.organizationId, changeRequestId],
    );
    await client.query(
      `UPDATE chime_app.appointments
       SET status = 'confirmed', version = version + 1, updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [context.organizationId, appointmentId],
    );
    await writeAudit(
      client,
      context,
      'appointment.change_withdrawn',
      appointmentId,
      { status: 'change_pending', version: change.version },
      { status: 'confirmed', version: change.version + 1, changeRequestId },
    );
    await writeEvent(
      client,
      context,
      'appointment.change_withdrawn',
      appointmentId,
      { appointmentId, changeRequestId },
      change.customer_email,
      'appointment_change_withdrawn',
    );
    return getAppointment(client, context.organizationId, appointmentId);
  });
}

export function createOperationsRouter(pool: Pool) {
  const router = Router();

  router.get('/operations', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const now = new Date();
    const startsAt = request.query.startsAt
      ? parseDate(request.query.startsAt, 'startsAt')
      : new Date(now.getTime() - 7 * 86_400_000);
    const endsAt = request.query.endsAt
      ? parseDate(request.query.endsAt, 'endsAt')
      : new Date(now.getTime() + 35 * 86_400_000);
    if (endsAt <= startsAt) {
      throw new AdminApiError(400, 'INVALID_RANGE', 'endsAt must be after startsAt.');
    }
    response.json(await listOperations(pool, session.organizationId, startsAt, endsAt));
  }));

  router.post(
    '/appointments/:appointmentId/decision',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const input = request.body as Record<string, unknown>;
      if (input?.decision !== 'approve' && input?.decision !== 'decline') {
        throw new AdminApiError(
          400,
          'INVALID_DECISION',
          'Decision must be approve or decline.',
        );
      }
      const note = input.note === undefined || input.note === null || input.note === ''
        ? null
        : requireText(input.note, 'note');
      const appointment = await decideAppointment(
        pool,
        parseUuid(request.params.appointmentId, 'appointmentId'),
        parseExpectedVersion(request.get('if-match')),
        input.decision,
        note,
        mutationContext(request),
      );
      response.setHeader('ETag', `"${appointment.version}"`);
      response.json({ appointment });
    }),
  );

  /**
   * Reports what a proposed time would collide with, without writing anything.
   *
   * The same conflicts were already refused on submit, but only after the
   * administrator had committed to the change. The plan asks to show buffer
   * conflicts and overlapping assignments *before* saving, so this answers
   * while they are still choosing. It runs findScheduleConflicts — the same
   * function the write path uses — so the two cannot disagree.
   */
  router.post(
    '/appointments/:appointmentId/change-requests/check',
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const appointmentId = parseUuid(request.params.appointmentId, 'appointmentId');
      const input = parseChangeInput(request.body);

      const found = await pool.query<{
        buffer_before_minutes: number;
        buffer_after_minutes: number;
      }>(
        `SELECT service.buffer_before_minutes, service.buffer_after_minutes
           FROM chime_app.appointments appointment
           JOIN chime_app.services service
             ON service.organization_id = appointment.organization_id
            AND service.id = appointment.service_id
          WHERE appointment.organization_id = $1 AND appointment.id = $2`,
        [session.organizationId, appointmentId],
      );
      const appointment = found.rows[0];
      if (!appointment) {
        throw new AdminApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment was not found.');
      }

      const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
      const conflicts = await findScheduleConflicts(pool, {
        organizationId: session.organizationId,
        appointmentId,
        staffMemberId: input.staffMemberId,
        startsAt: input.startsAt,
        endsAt,
        bufferBeforeMinutes: appointment.buffer_before_minutes,
        bufferAfterMinutes: appointment.buffer_after_minutes,
      });

      response.json({
        conflicts,
        buffers: {
          beforeMinutes: appointment.buffer_before_minutes,
          afterMinutes: appointment.buffer_after_minutes,
        },
        endsAt: endsAt.toISOString(),
      });
    }),
  );

  router.post(
    '/appointments/:appointmentId/change-requests',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const result = await requestChange(
        pool,
        parseUuid(request.params.appointmentId, 'appointmentId'),
        parseExpectedVersion(request.get('if-match')),
        parseChangeInput(request.body),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${result.appointment.version}"`);
      response.status(201).json(result);
    }),
  );

  router.post(
    '/appointments/:appointmentId/change-requests/:changeRequestId/withdraw',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const appointment = await withdrawChange(
        pool,
        parseUuid(request.params.appointmentId, 'appointmentId'),
        parseUuid(request.params.changeRequestId, 'changeRequestId'),
        parseExpectedVersion(request.get('if-match')),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${appointment.version}"`);
      response.json({ appointment });
    }),
  );

  router.post(
    '/notifications/:notificationId/read',
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const notificationId = parseUuid(
        request.params.notificationId,
        'notificationId',
      );
      const result = await pool.query(
        `UPDATE chime_app.in_app_notifications
         SET is_read = true, read_at = COALESCE(read_at, now())
         WHERE organization_id = $1
           AND id = $2
           AND audience = 'business'
         RETURNING id, is_read, read_at`,
        [session.organizationId, notificationId],
      );
      if (!result.rowCount) {
        throw new AdminApiError(
          404,
          'NOTIFICATION_NOT_FOUND',
          'Notification was not found.',
        );
      }
      response.json({
        notification: {
          id: result.rows[0].id,
          isRead: result.rows[0].is_read,
          readAt: iso(result.rows[0].read_at),
        },
      });
    }),
  );

  return router;
}
