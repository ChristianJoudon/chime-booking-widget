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
  render,
  renderHtml,
  sampleTemplateContext,
} from '../notifications/service.js';
import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, parseUuid, requireIdempotencyKey } from './validation.js';

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

/**
 * URL schemes permitted in imported newsletter HTML.
 *
 * An allowlist, not a blocklist. The previous version pattern-matched
 * `javascript:` and required the value to be quoted, so `<a href=javascript:...>`
 * with no quotes went straight through. Enumerating what is safe cannot be
 * bypassed by finding a scheme nobody thought to ban.
 */
const SAFE_LINK_SCHEME = /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i;
/** Images may also be inline data, which newsletters legitimately use. */
const SAFE_IMAGE_SCHEME = /^(?:https?:|\/(?!\/)|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

/**
 * Inline images are held in the template row, so they cannot be unbounded.
 *
 * Set below what fits in one request: the admin API caps bodies at 96 KB, so a
 * limit above that could never be reached — the request would be rejected by
 * body-parser first and the administrator would see a size error from the
 * transport rather than this one. Anything larger belongs on a host, linked by
 * URL.
 */
const MAX_INLINE_IMAGE_BYTES = 48 * 1024;

function attributeIsSafe(name: string, value: string): boolean {
  const trimmed = value.trim().replace(/^\s+/, '');
  if (!trimmed) return true;
  if (name.toLowerCase() === 'src') {
    if (!SAFE_IMAGE_SCHEME.test(trimmed)) return false;
    if (trimmed.toLowerCase().startsWith('data:')) {
      // base64 encodes 3 bytes per 4 characters.
      const payload = trimmed.slice(trimmed.indexOf(',') + 1);
      if ((payload.length * 3) / 4 > MAX_INLINE_IMAGE_BYTES) {
        throw new AdminApiError(
          400,
          'EMAIL_IMAGE_TOO_LARGE',
          `Inline images must be smaller than ${MAX_INLINE_IMAGE_BYTES / 1024} KB. Link to a hosted image instead.`,
        );
      }
    }
    return true;
  }
  return SAFE_LINK_SCHEME.test(trimmed);
}

/**
 * Every image must carry alt text, so a newsletter is not silent to anyone
 * reading it with images off or with a screen reader.
 */
function assertImagesAreDescribed(html: string): void {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const undescribed = images.filter((tag) => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    return !alt || !(alt[1] ?? alt[2] ?? alt[3] ?? '').trim();
  });
  if (undescribed.length) {
    throw new AdminApiError(
      400,
      'EMAIL_IMAGE_ALT_REQUIRED',
      `${undescribed.length} image${undescribed.length === 1 ? '' : 's'} in this content ${undescribed.length === 1 ? 'has' : 'have'} no alt text. Describe each image so the message still reads with images turned off.`,
    );
  }
}

/**
 * Strips executable content from imported email HTML.
 *
 * This is pattern-based, which is a real limitation: a parser would be more
 * durable against markup nobody anticipated. It is kept because the server has
 * no HTML parser dependency and the content is administrator-authored rather
 * than arriving from the public. The email clients that render it strip scripts
 * again on their own. Replacing this with a parser-based sanitizer is the
 * durable fix if imported HTML ever comes from a less trusted source.
 */
function sanitizeEmailHtml(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminApiError(400, 'INVALID_EMAIL_HTML', 'Email HTML must be text.');
  }
  // Also below the 96 KB request cap, for the same reason.
  if (value.length > 80_000) {
    throw new AdminApiError(400, 'EMAIL_HTML_TOO_LARGE', 'Imported email content must be smaller than 80 KB. Link to hosted images instead of embedding them.');
  }

  let sanitized = value
    // Executable and document-structure elements, with and without a closing tag.
    .replace(/<\s*(script|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|input|button|meta|base|link|svg|math)\b[^>]*\/?\s*>/gi, '')
    // Any inline event handler, quoted or not.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // href and src are rewritten through the allowlist, handling quoted and
  // unquoted values alike.
  sanitized = sanitized.replace(
    /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, name: string, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
      const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
      return attributeIsSafe(name, raw) ? match : ` ${name}="#"`;
    },
  );

  sanitized = sanitized.trim();
  if (!sanitized) return null;
  assertImagesAreDescribed(sanitized);
  return sanitized;
}

function contentFormat(value: unknown, hasHtml: boolean): 'plain' | 'rich' | 'html' | 'image' {
  if (!hasHtml) return 'plain';
  if (value === 'rich' || value === 'html' || value === 'image') return value;
  return 'rich';
}

function optionalAssetName(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminApiError(400, 'INVALID_ASSET_NAME', 'Imported asset name must be text.');
  }
  return value.trim().slice(0, 255) || null;
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
    bodyHtml: row.body_html ?? null,
    contentFormat: row.content_format ?? 'plain',
    sourceAssetName: row.source_asset_name ?? null,
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
         subject_template, body_template, body_html, content_format,
         source_asset_name, is_active, version, updated_at
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
      const bodyHtml = templateChannel === 'email'
        ? sanitizeEmailHtml(request.body?.bodyHtml)
        : null;
      const format = contentFormat(request.body?.contentFormat, Boolean(bodyHtml));
      const sourceAssetName = bodyHtml ? optionalAssetName(request.body?.sourceAssetName) : null;
      const isActive = request.body?.isActive !== false;
      const result = await pool.query(
        `UPDATE chime_app.notification_templates
         SET display_name = $5,
             subject_template = $6,
             body_template = $7,
             body_html = $8,
             content_format = $9,
             source_asset_name = $10,
             is_active = $11,
             version = version + 1,
             updated_at = now()
         WHERE organization_id = $1
           AND template_key = $2
           AND channel = $3
           AND version = $4
         RETURNING id, template_key, channel, display_name,
           subject_template, body_template, body_html, content_format,
           source_asset_name, is_active, version, updated_at`,
        [
          session.organizationId,
          templateKey,
          templateChannel,
          version,
          displayName,
          subjectTemplate,
          bodyTemplate,
          bodyHtml,
          format,
          sourceAssetName,
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

  /**
   * Sends one rendered test of a template to the signed-in administrator.
   *
   * The plan asks that an administrator be able to check a template safely
   * before it reaches customers. The recipient is taken from the session, never
   * from the request body, so this cannot be turned into a way to mail an
   * arbitrary address through the business's sender reputation.
   *
   * It queues a real delivery rather than faking one, so it travels the same
   * path as a customer message and honours the sandbox or live mode. The
   * rendered subject and body come back immediately so the administrator can
   * read them without waiting for the queue.
   */
  router.post(
    '/communications/templates/:templateKey/:channel/test',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const templateKey = requiredText(request.params.templateKey, 'templateKey', 100);
      const channel = requiredText(request.params.channel, 'channel', 20);
      const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));

      const found = await pool.query<{
        subject_template: string | null;
        body_template: string;
        body_html: string | null;
        display_name: string;
        business_name: string | null;
      }>(
        `SELECT template.subject_template, template.body_template, template.body_html,
                template.display_name,
                COALESCE(settings.public_name, organization.name) AS business_name
           FROM chime_app.notification_templates template
           JOIN chime_app.organizations organization ON organization.id = template.organization_id
           LEFT JOIN chime_app.business_settings settings
                  ON settings.organization_id = template.organization_id
          WHERE template.organization_id = $1
            AND template.template_key = $2
            AND template.channel = $3`,
        [session.organizationId, templateKey, channel],
      );
      const template = found.rows[0];
      if (!template) {
        throw new AdminApiError(404, 'TEMPLATE_NOT_FOUND', 'That template could not be found.');
      }

      const context = sampleTemplateContext(template.business_name ?? undefined);
      const subject = render(template.subject_template, context);
      const body = render(template.body_template, context) ?? '';
      const html = renderHtml(template.body_html, context);

      if (channel === 'email' && !session.email) {
        throw new AdminApiError(
          400,
          'NO_TEST_RECIPIENT',
          'This administrator account has no email address to send a test to.',
        );
      }

      await pool.query(
        `INSERT INTO chime_app.notification_deliveries (
           organization_id, channel, recipient, template_key, idempotency_key, status
         ) VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [session.organizationId, channel, session.email, templateKey, `test:${idempotencyKey}`],
      );

      const runtime = describeNotificationRuntime(notificationConfigFromEnv());
      response.status(202).json({
        queued: true,
        recipient: session.email,
        mode: runtime.mode,
        rendered: { subject, body, html },
      });
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

      // Suppressing stops a customer receiving something they were meant to
      // receive. Who did it and why is part of the record, not optional.
      const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
      if (reason.length < 3) {
        throw new AdminApiError(
          400,
          'REASON_REQUIRED',
          'Give a reason for suppressing this message. It is recorded with your name and the time.',
        );
      }

      const result = await pool.query(
        `UPDATE chime_app.notification_deliveries
         SET status = 'suppressed',
             suppressed_reason = $3,
             suppressed_by_user_id = $4,
             suppressed_at = now(),
             completed_at = now(),
             claimed_at = NULL,
             claim_token = NULL,
             last_error = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2
           AND status IN ('pending', 'failed')
         RETURNING id`,
        [session.organizationId, deliveryId, reason.slice(0, 500), session.subject],
      );
      if (!result.rowCount) {
        throw new AdminApiError(409, 'DELIVERY_NOT_SUPPRESSIBLE', 'This message is already processing or complete.');
      }
      await audit(pool, request, 'notification.delivery_suppressed', 'notification_delivery', deliveryId, {
        status: 'suppressed',
        reason: reason.slice(0, 500),
      });
      response.json({ delivery: { id: deliveryId, status: 'suppressed' } });
    }),
  );

  return router;
}
