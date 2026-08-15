import { randomUUID } from 'node:crypto';

import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Pool } from 'pg';

import {
  describeNotificationRuntime,
  notificationConfigFromEnv,
  processNotificationBatch,
} from '../notifications/service.js';
import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, parseUuid } from './validation.js';

const CHANNELS = new Set(['email', 'sms', 'push', 'webhook']);
const FILTERS = new Set(['all', 'ready', 'failed', 'sent', 'suppressed', 'processing']);

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requiredText(value: unknown, field: string, maximum = 10000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_COMMUNICATION', `${field} is required.`);
  }
  return value.trim().slice(0, maximum);
}

function optionalSubject(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, 'subjectTemplate', 500);
}

function channel(value: string): 'email' | 'sms' | 'push' | 'webhook' {
  if (!CHANNELS.has(value)) {
    throw new AdminApiError(400, 'INVALID_CHANNEL', 'Channel must be email, sms, push, or webhook.');
  }
  return value as 'email' | 'sms' | 'push' | 'webhook';
}

async function audit(
  pool: Pool,
  request: Request,
  action: string,
  entityType: string,
  entityId: string,
  afterState: Record<string, unknown>,
) {
  const session = getAdminSession(request);
  await pool.query(
    `INSERT INTO chime_app.audit_events (
       organization_id, actor_kind, actor_id, action,
       entity_type, entity_id, after_state, correlation_id
     ) VALUES ($1, 'user', $2, $3, $4, $5, $6, $7)`,
    [
      session.organizationId,
      session.subject,
      action,
      entityType,
      entityId,
      JSON.stringify(afterState),
      request.chimeRequestId ?? randomUUID(),
    ],
  );
}

function mapTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    templateKey: row.template_key,
    channel: row.channel,
    displayName: row.display_name,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    isActive: row.is_active,
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
  };
}

export function createCommunicationRouter(pool: Pool): Router {
  const router = Router();

  router.get('/communications', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const filter = typeof request.query.status === 'string' ? request.query.status : 'all';
    if (!FILTERS.has(filter)) {
      throw new AdminApiError(400, 'INVALID_STATUS', 'Unknown communication status filter.');
    }
    const limitValue = Number(request.query.limit ?? 60);
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 60;
    const clauses: Record<string, string> = {
      all: '',
      ready: "AND delivery.status IN ('pending', 'failed')",
      failed: "AND delivery.status = 'failed'",
      sent: "AND delivery.status IN ('sent', 'delivered')",
      suppressed: "AND delivery.status = 'suppressed'",
      processing: "AND delivery.status = 'processing'",
    };
    const [summaryResult, deliveryResult] = await Promise.all([
      pool.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE status = 'pending' AND available_at <= now())::int AS ready,
           count(*) FILTER (WHERE status = 'processing')::int AS processing,
           count(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS sent,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'suppressed')::int AS suppressed
         FROM chime_app.notification_deliveries
         WHERE organization_id = $1`,
        [session.organizationId],
      ),
      pool.query(
        `SELECT
           delivery.id,
           delivery.channel,
           delivery.recipient,
           delivery.template_key,
           delivery.provider_message_id,
           delivery.status,
           delivery.attempt_count,
           delivery.last_error,
           delivery.available_at,
           delivery.sent_at,
           delivery.created_at,
           outbox.event_type,
           outbox.aggregate_id,
           appointment.reference_code,
           customer.display_name AS customer_name,
           service.name AS service_name,
           COALESCE((
             SELECT jsonb_agg(to_jsonb(history) ORDER BY history.started_at DESC)
             FROM (
               SELECT attempt.provider,
                 attempt.provider_mode,
                 attempt.status,
                 attempt.error_message,
                 attempt.started_at
               FROM chime_app.notification_attempts attempt
               WHERE attempt.organization_id = delivery.organization_id
                 AND attempt.delivery_id = delivery.id
               ORDER BY attempt.started_at DESC
               LIMIT 3
             ) history
           ), '[]'::jsonb) AS attempts
         FROM chime_app.notification_deliveries delivery
         LEFT JOIN chime_app.outbox_events outbox
           ON outbox.id = delivery.outbox_event_id
         LEFT JOIN chime_app.appointments appointment
           ON appointment.organization_id = delivery.organization_id
          AND appointment.id = outbox.aggregate_id
          AND outbox.aggregate_type = 'appointment'
         LEFT JOIN chime_app.customers customer
           ON customer.organization_id = appointment.organization_id
          AND customer.id = appointment.customer_id
         LEFT JOIN chime_app.services service
           ON service.organization_id = appointment.organization_id
          AND service.id = appointment.service_id
         WHERE delivery.organization_id = $1
           ${clauses[filter]}
         ORDER BY
           CASE delivery.status
             WHEN 'failed' THEN 0
             WHEN 'pending' THEN 1
             WHEN 'processing' THEN 2
             ELSE 3
           END,
           delivery.created_at DESC
         LIMIT $2`,
        [session.organizationId, limit],
      ),
    ]);
    const summary = summaryResult.rows[0];
    const runtime = describeNotificationRuntime(notificationConfigFromEnv());
    response.json({
      runtime,
      summary: {
        total: Number(summary.total),
        ready: Number(summary.ready),
        processing: Number(summary.processing),
        sent: Number(summary.sent),
        failed: Number(summary.failed),
        suppressed: Number(summary.suppressed),
      },
      deliveries: deliveryResult.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        recipient: row.recipient,
        templateKey: row.template_key,
        providerMessageId: row.provider_message_id,
        status: row.status,
        attemptCount: Number(row.attempt_count),
        lastError: row.last_error,
        availableAt: iso(row.available_at),
        sentAt: iso(row.sent_at),
        createdAt: iso(row.created_at),
        eventType: row.event_type,
        appointmentId: row.aggregate_id,
        referenceCode: row.reference_code,
        customerName: row.customer_name,
        serviceName: row.service_name,
        attempts: Array.isArray(row.attempts)
          ? row.attempts.map((attempt: Record<string, unknown>) => ({
            provider: attempt.provider,
            providerMode: attempt.provider_mode,
            status: attempt.status,
            errorMessage: attempt.error_message,
            startedAt: iso(attempt.started_at),
          }))
          : [],
      })),
    });
  }));

  router.get('/communications/templates', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const result = await pool.query(
      `SELECT id, template_key, channel, display_name,
         subject_template, body_template, is_active, version, updated_at
       FROM chime_app.notification_templates
       WHERE organization_id = $1
       ORDER BY display_name, channel`,
      [session.organizationId],
    );
    response.json({ templates: result.rows.map(mapTemplate) });
  }));

  router.put(
    '/communications/templates/:templateKey/:channel',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const templateChannel = channel(String(request.params.channel));
      const templateKey = requiredText(request.params.templateKey, 'templateKey', 120);
      const version = parseExpectedVersion(request.get('if-match'));
      const displayName = requiredText(request.body?.displayName, 'displayName', 160);
      const subjectTemplate = optionalSubject(request.body?.subjectTemplate);
      const bodyTemplate = requiredText(request.body?.bodyTemplate, 'bodyTemplate', 10000);
      const isActive = request.body?.isActive !== false;
      const result = await pool.query(
        `UPDATE chime_app.notification_templates
         SET display_name = $5,
             subject_template = $6,
             body_template = $7,
             is_active = $8,
             version = version + 1,
             updated_at = now()
         WHERE organization_id = $1
           AND template_key = $2
           AND channel = $3
           AND version = $4
         RETURNING id, template_key, channel, display_name,
           subject_template, body_template, is_active, version, updated_at`,
        [
          session.organizationId,
          templateKey,
          templateChannel,
          version,
          displayName,
          subjectTemplate,
          bodyTemplate,
          isActive,
        ],
      );
      const template = result.rows[0];
      if (!template) {
        throw new AdminApiError(
          409,
          'TEMPLATE_VERSION_CONFLICT',
          'This message template changed in another session. Refresh before saving again.',
        );
      }
      await audit(pool, request, 'notification.template_updated', 'notification_template', template.id, {
        templateKey,
        channel: templateChannel,
        version: template.version,
      });
      response.setHeader('ETag', `"${template.version}"`);
      response.json({ template: mapTemplate(template) });
    }),
  );

  router.post(
    '/communications/process',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const result = await processNotificationBatch(
        pool,
        notificationConfigFromEnv(),
        session.organizationId,
      );
      response.json({ result });
    }),
  );

  router.post(
    '/communications/:deliveryId/retry',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const deliveryId = parseUuid(request.params.deliveryId, 'deliveryId');
      const result = await pool.query(
        `UPDATE chime_app.notification_deliveries
         SET status = 'pending',
             attempt_count = 0,
             available_at = now(),
             claimed_at = NULL,
             claim_token = NULL,
             completed_at = NULL,
             last_error = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2
           AND status IN ('failed', 'suppressed')
         RETURNING id, status, available_at`,
        [session.organizationId, deliveryId],
      );
      if (!result.rowCount) {
        throw new AdminApiError(409, 'DELIVERY_NOT_RETRYABLE', 'Only failed or suppressed messages can be retried.');
      }
      await audit(pool, request, 'notification.delivery_retried', 'notification_delivery', deliveryId, {
        status: 'pending',
      });
      response.json({ delivery: { id: deliveryId, status: 'pending', availableAt: iso(result.rows[0].available_at) } });
    }),
  );

  router.post(
    '/communications/:deliveryId/suppress',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const deliveryId = parseUuid(request.params.deliveryId, 'deliveryId');
      const result = await pool.query(
        `UPDATE chime_app.notification_deliveries
         SET status = 'suppressed',
             completed_at = now(),
             claimed_at = NULL,
             claim_token = NULL,
             last_error = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2
           AND status IN ('pending', 'failed')
         RETURNING id`,
        [session.organizationId, deliveryId],
      );
      if (!result.rowCount) {
        throw new AdminApiError(409, 'DELIVERY_NOT_SUPPRESSIBLE', 'This message is already processing or complete.');
      }
      await audit(pool, request, 'notification.delivery_suppressed', 'notification_delivery', deliveryId, {
        status: 'suppressed',
      });
      response.json({ delivery: { id: deliveryId, status: 'suppressed' } });
    }),
  );

  return router;
}
