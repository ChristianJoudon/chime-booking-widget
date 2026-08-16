import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { getAdminSession, requireRoles } from './auth.js';

type AsyncHandler = (request: Request, response: Response) => Promise<void>;
type LifecycleStatus = 'active' | 'vip' | 'watchlist' | 'blocked' | 'archived';
type PreferredChannel = 'email' | 'sms' | 'none';

const lifecycleStatuses = new Set<LifecycleStatus>(['active', 'vip', 'watchlist', 'blocked', 'archived']);
const preferredChannels = new Set<PreferredChannel>(['email', 'sms', 'none']);

const asyncRoute = (handler: AsyncHandler) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

const text = (value: unknown, maximum = 4000): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maximum);
};

const optionalText = (value: unknown, maximum = 4000): string | null => {
  const normalized = text(value, maximum);
  return normalized || null;
};

const requiredText = (value: unknown, field: string, maximum = 4000): string => {
  const normalized = text(value, maximum);
  if (!normalized) {
    const error = new Error(`${field} is required`) as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return normalized;
};

const queryText = (value: unknown, maximum = 120): string =>
  text(Array.isArray(value) ? value[0] : value, maximum);

const lifecycle = (value: unknown, fallback: LifecycleStatus = 'active'): LifecycleStatus => {
  const normalized = text(value, 24) as LifecycleStatus;
  return lifecycleStatuses.has(normalized) ? normalized : fallback;
};

const preferredChannel = (value: unknown, fallback: PreferredChannel = 'email'): PreferredChannel => {
  const normalized = text(value, 12) as PreferredChannel;
  return preferredChannels.has(normalized) ? normalized : fallback;
};

const expectedVersion = (request: Request): number | null => {
  const raw = request.get('if-match');
  if (!raw) return null;
  const parsed = Number(raw.replaceAll('"', ''));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const metadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const mapTag = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  color: row.color,
  customerCount: Number(row.customer_count ?? 0),
});

const mapCustomer = (row: Record<string, unknown>) => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email,
  phone: row.phone,
  timeZone: row.time_zone,
  marketingConsent: row.marketing_consent,
  lifecycleStatus: row.lifecycle_status,
  preferredChannel: row.preferred_channel,
  emailNotificationsEnabled: row.email_notifications_enabled,
  smsNotificationsEnabled: row.sms_notifications_enabled,
  locale: row.locale,
  metadata: row.metadata ?? {},
  version: Number(row.version),
  tags: row.tags ?? [],
  appointmentCount: Number(row.appointment_count ?? 0),
  upcomingAppointmentCount: Number(row.upcoming_appointment_count ?? 0),
  completedAppointmentCount: Number(row.completed_appointment_count ?? 0),
  nextAppointmentAt: row.next_appointment_at,
  lastAppointmentAt: row.last_appointment_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const customerSelect = `
  WITH appointment_stats AS (
    SELECT
      customer_id,
      count(*) FILTER (WHERE status <> 'cancelled') AS appointment_count,
      count(*) FILTER (WHERE starts_at >= now() AND status NOT IN ('cancelled', 'completed')) AS upcoming_appointment_count,
      count(*) FILTER (WHERE status = 'completed') AS completed_appointment_count,
      min(starts_at) FILTER (WHERE starts_at >= now() AND status NOT IN ('cancelled', 'completed')) AS next_appointment_at,
      max(starts_at) FILTER (WHERE starts_at < now() OR status = 'completed') AS last_appointment_at
    FROM chime_app.appointments
    WHERE organization_id = $1
    GROUP BY customer_id
  ), tag_rollup AS (
    SELECT
      assignment.customer_id,
      jsonb_agg(
        jsonb_build_object('id', tag.id, 'name', tag.name, 'color', tag.color)
        ORDER BY lower(tag.name)
      ) AS tags
    FROM chime_app.customer_tag_assignments assignment
    JOIN chime_app.customer_tags tag ON tag.id = assignment.tag_id
    WHERE assignment.organization_id = $1
    GROUP BY assignment.customer_id
  )
  SELECT
    customer.*,
    COALESCE(tag_rollup.tags, '[]'::jsonb) AS tags,
    COALESCE(appointment_stats.appointment_count, 0) AS appointment_count,
    COALESCE(appointment_stats.upcoming_appointment_count, 0) AS upcoming_appointment_count,
    COALESCE(appointment_stats.completed_appointment_count, 0) AS completed_appointment_count,
    appointment_stats.next_appointment_at,
    appointment_stats.last_appointment_at
  FROM chime_app.customers customer
  LEFT JOIN appointment_stats ON appointment_stats.customer_id = customer.id
  LEFT JOIN tag_rollup ON tag_rollup.customer_id = customer.id`;

export function createCustomerRouter(pool: Pool): Router {
  const router = Router();

  router.get('/customers/tags', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const result = await pool.query(
      `SELECT tag.id, tag.name, tag.color, count(assignment.customer_id) AS customer_count
       FROM chime_app.customer_tags tag
       LEFT JOIN chime_app.customer_tag_assignments assignment
         ON assignment.tag_id = tag.id AND assignment.organization_id = tag.organization_id
       WHERE tag.organization_id = $1
       GROUP BY tag.id
       ORDER BY lower(tag.name)`,
      [session.organizationId],
    );
    response.json({ tags: result.rows.map(mapTag) });
  }));

  router.post(
    '/customers/tags',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const name = requiredText(request.body?.name, 'name', 40);
      const color = /^#[0-9a-f]{6}$/i.test(text(request.body?.color, 7))
        ? text(request.body.color, 7)
        : '#5f927f';
      const id = randomUUID();
      const inserted = await pool.query(
        `INSERT INTO chime_app.customer_tags (id, organization_id, name, color)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id, name, color, 0::bigint AS customer_count`,
        [id, session.organizationId, name, color],
      );
      if (!inserted.rowCount) {
        const existing = await pool.query(
          `SELECT id, name, color, 0::bigint AS customer_count
           FROM chime_app.customer_tags
           WHERE organization_id = $1 AND lower(name) = lower($2)`,
          [session.organizationId, name],
        );
        response.status(200).json({ tag: mapTag(existing.rows[0]) });
        return;
      }
      response.status(201).json({ tag: mapTag(inserted.rows[0]) });
    }),
  );

  router.get('/customers', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const search = queryText(request.query.search);
    const status = queryText(request.query.status, 24);
    const tagId = queryText(request.query.tagId, 80);
    // Smoke runs create real customer rows. Keep them out of the customer book
    // unless a caller explicitly asks for them.
    const includeTest = request.query.includeTest === 'true';
    const result = await pool.query(
      `${customerSelect}
       WHERE customer.organization_id = $1
         AND ($5::boolean OR customer.origin <> 'test')
         AND ($2 = '' OR customer.display_name ILIKE '%' || $2 || '%'
           OR COALESCE(customer.email, '') ILIKE '%' || $2 || '%'
           OR COALESCE(customer.phone, '') ILIKE '%' || $2 || '%')
         AND ($3 = '' OR customer.lifecycle_status = $3)
         AND ($4 = '' OR EXISTS (
           SELECT 1 FROM chime_app.customer_tag_assignments filter_tag
           WHERE filter_tag.organization_id = $1
             AND filter_tag.customer_id = customer.id
             AND filter_tag.tag_id::text = $4
         ))
       ORDER BY
         CASE customer.lifecycle_status WHEN 'vip' THEN 0 WHEN 'watchlist' THEN 1 ELSE 2 END,
         appointment_stats.next_appointment_at NULLS LAST,
         lower(customer.display_name)
       LIMIT 250`,
      [session.organizationId, search, status, tagId, includeTest],
    );
    response.json({ customers: result.rows.map(mapCustomer) });
  }));

  router.post(
    '/customers',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const displayName = requiredText(request.body?.displayName, 'displayName', 160);
      const email = optionalText(request.body?.email, 320);
      const phone = optionalText(request.body?.phone, 40);
      if (!email && !phone) {
        response.status(400).json({ error: 'An email address or phone number is required.' });
        return;
      }
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO chime_app.customers (
           id, organization_id, display_name, email, phone, time_zone, marketing_consent,
           lifecycle_status, preferred_channel, email_notifications_enabled,
           sms_notifications_enabled, locale, metadata, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, 1)
         RETURNING *, '[]'::jsonb AS tags, 0::bigint AS appointment_count,
           0::bigint AS upcoming_appointment_count, 0::bigint AS completed_appointment_count,
           NULL::timestamptz AS next_appointment_at, NULL::timestamptz AS last_appointment_at`,
        [
          id,
          session.organizationId,
          displayName,
          email,
          phone,
          text(request.body?.timeZone, 80) || 'Pacific/Honolulu',
          request.body?.marketingConsent === true,
          lifecycle(request.body?.lifecycleStatus),
          preferredChannel(request.body?.preferredChannel),
          request.body?.emailNotificationsEnabled !== false,
          request.body?.smsNotificationsEnabled !== false,
          text(request.body?.locale, 16) || 'en',
          JSON.stringify(metadata(request.body?.metadata)),
        ],
      );
      response.status(201).json({ customer: mapCustomer(result.rows[0]) });
    }),
  );

  router.get('/customers/:customerId', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const customerId = String(request.params.customerId);
    const customerResult = await pool.query(
      `${customerSelect}
       WHERE customer.organization_id = $1 AND customer.id = $2`,
      [session.organizationId, customerId],
    );
    if (!customerResult.rowCount) {
      response.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const customer = mapCustomer(customerResult.rows[0]);
    const contacts = [customerResult.rows[0].email, customerResult.rows[0].phone].filter(Boolean);
    const [appointments, notes, communications, changes] = await Promise.all([
      pool.query(
        `SELECT
           appointment.id, appointment.reference_code, appointment.starts_at, appointment.ends_at,
           appointment.status, appointment.source, appointment.customer_notes, appointment.internal_notes,
           appointment.version, service.name AS service_name, location.name AS location_name,
           COALESCE(
             jsonb_agg(DISTINCT jsonb_build_object('id', staff.id, 'displayName', staff.display_name, 'color', staff.color))
             FILTER (WHERE staff.id IS NOT NULL),
             '[]'::jsonb
           ) AS staff
         FROM chime_app.appointments appointment
         JOIN chime_app.services service ON service.id = appointment.service_id
         LEFT JOIN chime_app.locations location ON location.id = appointment.location_id
         LEFT JOIN chime_app.appointment_staff appointment_staff
           ON appointment_staff.appointment_id = appointment.id
           AND appointment_staff.organization_id = appointment.organization_id
         LEFT JOIN chime_app.staff_members staff ON staff.id = appointment_staff.staff_member_id
         WHERE appointment.organization_id = $1 AND appointment.customer_id = $2
         GROUP BY appointment.id, service.name, location.name
         ORDER BY appointment.starts_at DESC
         LIMIT 150`,
        [session.organizationId, customerId],
      ),
      pool.query(
        `SELECT id, body, is_pinned, created_by_role, created_at, updated_at
         FROM chime_app.customer_notes
         WHERE organization_id = $1 AND customer_id = $2
         ORDER BY is_pinned DESC, created_at DESC
         LIMIT 100`,
        [session.organizationId, customerId],
      ),
      pool.query(
        `SELECT id, channel, recipient, template_key, status, attempt_count,
           last_error, sent_at, delivered_at, completed_at, created_at
         FROM chime_app.notification_deliveries
         WHERE organization_id = $1
           AND (
             COALESCE(metadata ->> 'customerId', metadata ->> 'customer_id') = $2
             OR recipient = ANY($3::text[])
           )
         ORDER BY created_at DESC
         LIMIT 100`,
        [session.organizationId, customerId, contacts],
      ),
      pool.query(
        `SELECT change_request.id, change_request.appointment_id, change_request.status,
           change_request.reason, change_request.proposed_changes, change_request.created_at,
           change_request.resolved_at, appointment.reference_code
         FROM chime_app.appointment_change_requests change_request
         JOIN chime_app.appointments appointment ON appointment.id = change_request.appointment_id
         WHERE change_request.organization_id = $1 AND appointment.customer_id = $2
         ORDER BY change_request.created_at DESC
         LIMIT 100`,
        [session.organizationId, customerId],
      ),
    ]);
    response.json({
      customer,
      appointments: appointments.rows.map((row) => ({
        id: row.id,
        referenceCode: row.reference_code,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        source: row.source,
        customerNotes: row.customer_notes,
        internalNotes: row.internal_notes,
        version: Number(row.version),
        serviceName: row.service_name,
        locationName: row.location_name,
        staff: row.staff ?? [],
      })),
      notes: notes.rows.map((row) => ({
        id: row.id,
        body: row.body,
        isPinned: row.is_pinned,
        createdByRole: row.created_by_role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      communications: communications.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        recipient: row.recipient,
        templateKey: row.template_key,
        status: row.status,
        attemptCount: Number(row.attempt_count),
        lastError: row.last_error,
        sentAt: row.sent_at,
        deliveredAt: row.delivered_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      })),
      changeRequests: changes.rows.map((row) => ({
        id: row.id,
        appointmentId: row.appointment_id,
        referenceCode: row.reference_code,
        status: row.status,
        reason: row.reason,
        proposedChanges: row.proposed_changes,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
    });
  }));

  router.put(
    '/customers/:customerId',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const customerId = String(request.params.customerId);
      const version = expectedVersion(request);
      if (!version) {
        response.status(428).json({ error: 'If-Match with the customer version is required.' });
        return;
      }
      const current = await pool.query(
        `SELECT * FROM chime_app.customers WHERE organization_id = $1 AND id = $2`,
        [session.organizationId, customerId],
      );
      if (!current.rowCount) {
        response.status(404).json({ error: 'Customer not found.' });
        return;
      }
      const before = current.rows[0];
      const nextLifecycle = lifecycle(request.body?.lifecycleStatus, before.lifecycle_status);
      const nextPreferred = preferredChannel(request.body?.preferredChannel, before.preferred_channel);
      const emailEnabled = nextLifecycle === 'blocked' || nextLifecycle === 'archived'
        ? false
        : typeof request.body?.emailNotificationsEnabled === 'boolean'
          ? request.body.emailNotificationsEnabled
          : before.email_notifications_enabled;
      const smsEnabled = nextLifecycle === 'blocked' || nextLifecycle === 'archived'
        ? false
        : typeof request.body?.smsNotificationsEnabled === 'boolean'
          ? request.body.smsNotificationsEnabled
          : before.sms_notifications_enabled;
      const updated = await pool.query(
        `UPDATE chime_app.customers
         SET display_name = $4, email = $5, phone = $6, time_zone = $7,
           marketing_consent = $8, lifecycle_status = $9, preferred_channel = $10,
           email_notifications_enabled = $11, sms_notifications_enabled = $12,
           locale = $13, metadata = $14::jsonb, version = version + 1, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND version = $3
         RETURNING *, '[]'::jsonb AS tags, 0::bigint AS appointment_count,
           0::bigint AS upcoming_appointment_count, 0::bigint AS completed_appointment_count,
           NULL::timestamptz AS next_appointment_at, NULL::timestamptz AS last_appointment_at`,
        [
          session.organizationId,
          customerId,
          version,
          requiredText(request.body?.displayName ?? before.display_name, 'displayName', 160),
          request.body?.email === undefined ? before.email : optionalText(request.body.email, 320),
          request.body?.phone === undefined ? before.phone : optionalText(request.body.phone, 40),
          text(request.body?.timeZone, 80) || before.time_zone,
          typeof request.body?.marketingConsent === 'boolean' ? request.body.marketingConsent : before.marketing_consent,
          nextLifecycle,
          nextPreferred,
          emailEnabled,
          smsEnabled,
          text(request.body?.locale, 16) || before.locale,
          JSON.stringify(request.body?.metadata === undefined ? before.metadata : metadata(request.body.metadata)),
        ],
      );
      if (!updated.rowCount) {
        response.status(409).json({ error: 'Customer changed in another session. Refresh and try again.' });
        return;
      }
      if (!emailEnabled || !smsEnabled || nextLifecycle === 'blocked' || nextLifecycle === 'archived') {
        const contacts = [updated.rows[0].email, updated.rows[0].phone].filter(Boolean);
        await pool.query(
          `UPDATE chime_app.notification_deliveries
           SET status = 'suppressed', last_error = 'Suppressed by customer contact preference',
             completed_at = now(), updated_at = now()
           WHERE organization_id = $1
             AND status IN ('pending', 'retrying')
             AND (
               COALESCE(metadata ->> 'customerId', metadata ->> 'customer_id') = $2
               OR recipient = ANY($3::text[])
             )
             AND (
               ($4::boolean = false AND channel = 'email')
               OR ($5::boolean = false AND channel = 'sms')
               OR $6::boolean = true
             )`,
          [session.organizationId, customerId, contacts, emailEnabled, smsEnabled, nextLifecycle === 'blocked' || nextLifecycle === 'archived'],
        );
      }
      response.json({ customer: mapCustomer(updated.rows[0]) });
    }),
  );

  router.put(
    '/customers/:customerId/tags',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const customerId = String(request.params.customerId);
      const tagIds = Array.isArray(request.body?.tagIds)
        ? [...new Set(request.body.tagIds.map((value: unknown) => text(value, 80)).filter(Boolean))]
        : [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const customer = await client.query(
          `SELECT id FROM chime_app.customers WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
          [session.organizationId, customerId],
        );
        if (!customer.rowCount) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'Customer not found.' });
          return;
        }
        if (tagIds.length) {
          const validTags = await client.query(
            `SELECT id FROM chime_app.customer_tags
             WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
            [session.organizationId, tagIds],
          );
          if (validTags.rowCount !== tagIds.length) {
            await client.query('ROLLBACK');
            response.status(400).json({ error: 'One or more tags are invalid.' });
            return;
          }
        }
        await client.query(
          `DELETE FROM chime_app.customer_tag_assignments
           WHERE organization_id = $1 AND customer_id = $2`,
          [session.organizationId, customerId],
        );
        if (tagIds.length) {
          await client.query(
            `INSERT INTO chime_app.customer_tag_assignments (
               organization_id, customer_id, tag_id, created_by_role
             )
             SELECT $1, $2, unnest($3::uuid[]), $4`,
            [session.organizationId, customerId, tagIds, session.role],
          );
        }
        const tags = await client.query(
          `SELECT tag.id, tag.name, tag.color, 0::bigint AS customer_count
           FROM chime_app.customer_tags tag
           JOIN chime_app.customer_tag_assignments assignment ON assignment.tag_id = tag.id
           WHERE assignment.organization_id = $1 AND assignment.customer_id = $2
           ORDER BY lower(tag.name)`,
          [session.organizationId, customerId],
        );
        await client.query('COMMIT');
        response.json({ tags: tags.rows.map(mapTag) });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    '/customers/:customerId/notes',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const customerId = String(request.params.customerId);
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO chime_app.customer_notes (
           id, organization_id, customer_id, body, is_pinned, created_by_role
         )
         SELECT $1, $2, customer.id, $4, $5, $6
         FROM chime_app.customers customer
         WHERE customer.organization_id = $2 AND customer.id = $3
         RETURNING id, body, is_pinned, created_by_role, created_at, updated_at`,
        [id, session.organizationId, customerId, requiredText(request.body?.body, 'body'), request.body?.isPinned === true, session.role],
      );
      if (!result.rowCount) {
        response.status(404).json({ error: 'Customer not found.' });
        return;
      }
      const row = result.rows[0];
      response.status(201).json({
        note: {
          id: row.id,
          body: row.body,
          isPinned: row.is_pinned,
          createdByRole: row.created_by_role,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    }),
  );

  router.delete(
    '/customers/:customerId/notes/:noteId',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const deleted = await pool.query(
        `DELETE FROM chime_app.customer_notes
         WHERE organization_id = $1 AND customer_id = $2 AND id = $3
         RETURNING id`,
        [session.organizationId, String(request.params.customerId), String(request.params.noteId)],
      );
      if (!deleted.rowCount) {
        response.status(404).json({ error: 'Note not found.' });
        return;
      }
      response.status(204).end();
    }),
  );

  return router;
}
