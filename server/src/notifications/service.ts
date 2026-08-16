import { createHmac, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export type NotificationMode = 'sandbox' | 'live';

export interface NotificationRuntimeConfig {
  mode: NotificationMode;
  batchSize: number;
  maxAttempts: number;
  leaseSeconds: number;
  resendApiKey: string | null;
  emailFrom: string | null;
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioFrom: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

interface ClaimedDelivery {
  id: string;
  organization_id: string;
  outbox_event_id: string | null;
  channel: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  template_key: string;
  idempotency_key: string;
  attempt_count: number;
  claim_token: string;
  metadata: Record<string, unknown>;
}

interface RenderedMessage {
  subject: string | null;
  body: string;
  html: string | null;
  eventType: string | null;
}

interface ProviderResult {
  provider: string;
  providerMessageId: string;
  responseSummary: Record<string, unknown>;
}

export interface NotificationBatchResult {
  mode: NotificationMode;
  claimed: number;
  sent: number;
  failed: number;
  deliveries: Array<{
    id: string;
    status: 'sent' | 'failed';
    provider: string;
    error?: string;
  }>;
}

const FALLBACK_TEMPLATES: Record<string, { subject: string | null; body: string }> = {
  booking_received: {
    subject: 'We received your appointment',
    body: 'Hi {{customer.name}},\n\nWe received your {{service.name}} appointment for {{appointment.when}}.',
  },
  booking_confirmed: {
    subject: 'Your appointment is confirmed',
    body: 'Hi {{customer.name}},\n\nYour {{service.name}} appointment is confirmed for {{appointment.when}}.',
  },
  appointment_change_requested: {
    subject: 'Please review an appointment change',
    body: 'Hi {{customer.name}},\n\nPlease review the proposed appointment change: {{approval.url}}',
  },
  appointment_change_approved: {
    subject: 'Your new appointment time is confirmed',
    body: 'Hi {{customer.name}},\n\nYour updated appointment is confirmed for {{appointment.when}}.',
  },
  appointment_change_declined: {
    subject: 'Your original appointment is still confirmed',
    body: 'Hi {{customer.name}},\n\nYour original appointment remains confirmed for {{appointment.when}}.',
  },
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function notificationConfigFromEnv(): NotificationRuntimeConfig {
  const explicitlyLive = process.env.CHIME_NOTIFICATION_MODE === 'live'
    && process.env.CHIME_NOTIFICATIONS_LIVE === 'true';
  return {
    mode: explicitlyLive ? 'live' : 'sandbox',
    batchSize: positiveInteger(process.env.CHIME_NOTIFICATION_BATCH_SIZE, 20, 100),
    maxAttempts: positiveInteger(process.env.CHIME_NOTIFICATION_MAX_ATTEMPTS, 5, 20),
    leaseSeconds: positiveInteger(process.env.CHIME_NOTIFICATION_LEASE_SECONDS, 120, 3600),
    resendApiKey: process.env.CHIME_RESEND_API_KEY?.trim() || null,
    emailFrom: process.env.CHIME_EMAIL_FROM?.trim() || null,
    twilioAccountSid: process.env.CHIME_TWILIO_ACCOUNT_SID?.trim() || null,
    twilioAuthToken: process.env.CHIME_TWILIO_AUTH_TOKEN?.trim() || null,
    twilioFrom: process.env.CHIME_TWILIO_FROM?.trim() || null,
    webhookUrl: process.env.CHIME_NOTIFICATION_WEBHOOK_URL?.trim() || null,
    webhookSecret: process.env.CHIME_NOTIFICATION_WEBHOOK_SECRET?.trim() || null,
  };
}

export function describeNotificationRuntime(config: NotificationRuntimeConfig) {
  return {
    mode: config.mode,
    providers: {
      email: config.mode === 'sandbox' || Boolean(config.resendApiKey && config.emailFrom),
      sms: config.mode === 'sandbox'
        || Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFrom),
      webhook: config.mode === 'sandbox' || Boolean(config.webhookUrl),
    },
    maxAttempts: config.maxAttempts,
  };
}

function pathValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function render(source: string | null, context: Record<string, unknown>): string | null {
  if (source === null) return null;
  return source.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_match, path: string) =>
    textValue(pathValue(context, path), ''));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderHtml(source: string | null, context: Record<string, unknown>): string | null {
  if (source === null) return null;
  return source.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_match, path: string) =>
    escapeHtml(textValue(pathValue(context, path), '')));
}

function appointmentWhen(startsAt: unknown, timeZone: unknown): string {
  if (!startsAt) return 'the scheduled time';
  const date = new Date(String(startsAt));
  if (Number.isNaN(date.getTime())) return 'the scheduled time';
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: textValue(timeZone, 'UTC'),
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function isoDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function claimDeliveries(
  pool: Pool,
  config: NotificationRuntimeConfig,
  organizationId: string | null,
): Promise<ClaimedDelivery[]> {
  const claimToken = randomUUID();
  const result = await pool.query<ClaimedDelivery>(
    `WITH candidates AS (
       SELECT delivery.id
       FROM chime_app.notification_deliveries delivery
       WHERE (
           delivery.status IN ('pending', 'failed')
           OR (
             delivery.status = 'processing'
             AND delivery.claimed_at < now() - ($2::text || ' seconds')::interval
           )
         )
         AND delivery.available_at <= now()
         AND delivery.attempt_count < $3
         AND ($4::uuid IS NULL OR delivery.organization_id = $4::uuid)
       ORDER BY delivery.available_at, delivery.created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE chime_app.notification_deliveries delivery
     SET status = 'processing',
         claimed_at = now(),
         claim_token = $5,
         attempt_count = delivery.attempt_count + 1,
         updated_at = now()
     FROM candidates
     WHERE delivery.id = candidates.id
     RETURNING delivery.id,
       delivery.organization_id,
       delivery.outbox_event_id,
       delivery.channel,
       delivery.recipient,
       delivery.template_key,
       delivery.idempotency_key,
       delivery.attempt_count,
       delivery.claim_token,
       delivery.metadata`,
    [config.batchSize, config.leaseSeconds, config.maxAttempts, organizationId, claimToken],
  );
  return result.rows;
}

async function loadRenderedMessage(pool: Pool, delivery: ClaimedDelivery): Promise<RenderedMessage> {
  const result = await pool.query(
    `SELECT
       outbox.event_type,
       outbox.payload,
       template.subject_template,
       template.body_template,
       template.body_html,
       appointment.reference_code,
       appointment.starts_at,
       appointment.time_zone,
       customer.display_name AS customer_name,
       customer.email AS customer_email,
       customer.phone AS customer_phone,
       service.name AS service_name,
       location.name AS location_name,
       (
         SELECT string_agg(staff.display_name, ', ' ORDER BY staff.display_name)
         FROM chime_app.appointment_staff appointment_staff
         JOIN chime_app.staff_members staff
           ON staff.organization_id = appointment_staff.organization_id
          AND staff.id = appointment_staff.staff_member_id
         WHERE appointment_staff.organization_id = appointment.organization_id
           AND appointment_staff.appointment_id = appointment.id
       ) AS staff_name
     FROM chime_app.notification_deliveries notification
     LEFT JOIN chime_app.outbox_events outbox
       ON outbox.id = notification.outbox_event_id
     LEFT JOIN chime_app.notification_templates template
       ON template.organization_id = notification.organization_id
      AND template.template_key = notification.template_key
      AND template.channel = notification.channel
      AND template.is_active = true
     LEFT JOIN chime_app.appointments appointment
       ON appointment.organization_id = notification.organization_id
      AND appointment.id = outbox.aggregate_id
      AND outbox.aggregate_type = 'appointment'
     LEFT JOIN chime_app.customers customer
       ON customer.organization_id = appointment.organization_id
      AND customer.id = appointment.customer_id
     LEFT JOIN chime_app.services service
       ON service.organization_id = appointment.organization_id
      AND service.id = appointment.service_id
     LEFT JOIN chime_app.locations location
       ON location.organization_id = appointment.organization_id
      AND location.id = appointment.location_id
     WHERE notification.organization_id = $1
       AND notification.id = $2`,
    [delivery.organization_id, delivery.id],
  );
  const row = result.rows[0] ?? {};
  const payload = row.payload && typeof row.payload === 'object'
    ? row.payload as Record<string, unknown>
    : {};
  const fallback = FALLBACK_TEMPLATES[delivery.template_key] ?? {
    subject: 'An update from Chime',
    body: 'There is an update to your appointment.',
  };
  const approvalUrl = pathValue(payload, 'approvalUrl')
    ?? pathValue(payload, 'customerAction.approvalUrl')
    ?? pathValue(payload, 'customerAction.url');
  const startsAt = row.starts_at ?? pathValue(payload, 'startsAt')
    ?? pathValue(payload, 'proposedChanges.startsAt');
  const timeZone = row.time_zone ?? pathValue(payload, 'timeZone') ?? 'UTC';
  const context: Record<string, unknown> = {
    payload,
    customer: {
      name: row.customer_name ?? pathValue(payload, 'customerName') ?? 'there',
      email: row.customer_email ?? pathValue(payload, 'customerEmail') ?? '',
      phone: row.customer_phone ?? pathValue(payload, 'customerPhone') ?? '',
    },
    service: {
      name: row.service_name ?? pathValue(payload, 'serviceName') ?? 'appointment',
    },
    appointment: {
      referenceCode: row.reference_code ?? pathValue(payload, 'referenceCode') ?? '',
      startsAt: isoDate(startsAt),
      when: appointmentWhen(startsAt, timeZone),
    },
    staff: {
      name: row.staff_name ?? pathValue(payload, 'staffName') ?? 'your provider',
    },
    location: {
      name: row.location_name ?? pathValue(payload, 'locationName') ?? 'the scheduled location',
    },
    approval: {
      url: textValue(approvalUrl),
    },
  };
  return {
    eventType: row.event_type ? String(row.event_type) : null,
    subject: render(row.subject_template ?? fallback.subject, context),
    body: render(row.body_template ?? fallback.body, context) ?? fallback.body,
    html: renderHtml(row.body_html ?? null, context),
  };
}

async function sendLive(
  config: NotificationRuntimeConfig,
  delivery: ClaimedDelivery,
  message: RenderedMessage,
): Promise<ProviderResult> {
  if (delivery.channel === 'email') {
    if (!config.resendApiKey || !config.emailFrom) {
      throw new Error('Live email is not configured. Add a Resend API key and sender address.');
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': delivery.idempotency_key,
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [delivery.recipient],
        subject: message.subject ?? 'An update from Chime',
        text: message.body,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    return {
      provider: 'resend',
      providerMessageId: textValue(body.id, `resend-${randomUUID()}`),
      responseSummary: { status: response.status },
    };
  }

  if (delivery.channel === 'sms') {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFrom) {
      throw new Error('Live SMS is not configured. Add Twilio credentials and a sender number.');
    }
    const form = new URLSearchParams({
      To: delivery.recipient,
      From: config.twilioFrom,
      Body: message.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      },
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`SMS provider returned ${response.status}.`);
    return {
      provider: 'twilio',
      providerMessageId: textValue(body.sid, `twilio-${randomUUID()}`),
      responseSummary: { status: response.status },
    };
  }

  if (delivery.channel === 'webhook') {
    const url = delivery.recipient.startsWith('http') ? delivery.recipient : config.webhookUrl;
    if (!url) throw new Error('Live webhook delivery is not configured.');
    const body = JSON.stringify({
      deliveryId: delivery.id,
      eventType: message.eventType,
      subject: message.subject,
      body: message.body,
      html: message.html,
    });
    const signature = config.webhookSecret
      ? createHmac('sha256', config.webhookSecret).update(body).digest('hex')
      : null;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': delivery.idempotency_key,
        ...(signature ? { 'X-Chime-Signature': `sha256=${signature}` } : {}),
      },
      body,
    });
    if (!response.ok) throw new Error(`Webhook endpoint returned ${response.status}.`);
    return {
      provider: 'webhook',
      providerMessageId: response.headers.get('x-request-id') ?? `webhook-${randomUUID()}`,
      responseSummary: { status: response.status },
    };
  }

  throw new Error('Push delivery is not configured.');
}

async function sendMessage(
  config: NotificationRuntimeConfig,
  delivery: ClaimedDelivery,
  message: RenderedMessage,
): Promise<ProviderResult> {
  if (config.mode === 'sandbox') {
    return {
      provider: `sandbox-${delivery.channel}`,
      providerMessageId: `sandbox-${randomUUID()}`,
      responseSummary: { simulated: true },
    };
  }
  return sendLive(config, delivery, message);
}

async function refreshOutbox(
  client: PoolClient,
  outboxEventId: string | null,
  maxAttempts: number,
  lastError: string | null,
) {
  if (!outboxEventId) return;
  const stateResult = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE status IN ('pending', 'processing')
            OR (status = 'failed' AND attempt_count < $2)
       )::int AS active_count,
       count(*) FILTER (
         WHERE status = 'failed' AND attempt_count >= $2
       )::int AS exhausted_count,
       max(attempt_count)::int AS max_attempt_count
     FROM chime_app.notification_deliveries
     WHERE outbox_event_id = $1`,
    [outboxEventId, maxAttempts],
  );
  const state = stateResult.rows[0];
  const activeCount = Number(state?.active_count ?? 0);
  const exhaustedCount = Number(state?.exhausted_count ?? 0);
  const status = exhaustedCount > 0 ? 'failed' : activeCount === 0 ? 'published' : 'pending';
  await client.query(
    `UPDATE chime_app.outbox_events
     SET status = $2,
         attempt_count = GREATEST(attempt_count, $3),
         published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
         last_error = CASE WHEN $2 = 'published' THEN NULL ELSE $4 END,
         available_at = CASE WHEN $2 = 'pending' THEN now() ELSE available_at END
     WHERE id = $1`,
    [outboxEventId, status, Number(state?.max_attempt_count ?? 0), lastError],
  );
}

async function finishSuccess(
  pool: Pool,
  config: NotificationRuntimeConfig,
  delivery: ClaimedDelivery,
  provider: ProviderResult,
  message: RenderedMessage,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO chime_app.notification_attempts (
         organization_id, delivery_id, attempt_number, provider,
         provider_mode, status, request_summary, response_summary
       ) VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7)`,
      [
        delivery.organization_id,
        delivery.id,
        delivery.attempt_count,
        provider.provider,
        config.mode,
        JSON.stringify({
          channel: delivery.channel,
          eventType: message.eventType,
          subjectLength: message.subject?.length ?? 0,
          bodyLength: message.body.length,
          htmlLength: message.html?.length ?? 0,
        }),
        JSON.stringify(provider.responseSummary),
      ],
    );
    const updated = await client.query(
      `UPDATE chime_app.notification_deliveries
       SET status = 'sent',
           provider_message_id = $3,
           last_error = NULL,
           sent_at = COALESCE(sent_at, now()),
           completed_at = now(),
           claimed_at = NULL,
           claim_token = NULL,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2
         AND claim_token = $4`,
      [delivery.organization_id, delivery.id, provider.providerMessageId, delivery.claim_token],
    );
    if (!updated.rowCount) throw new Error('Notification claim was lost before completion.');
    await refreshOutbox(client, delivery.outbox_event_id, config.maxAttempts, null);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finishFailure(
  pool: Pool,
  config: NotificationRuntimeConfig,
  delivery: ClaimedDelivery,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : 'Notification provider failed.';
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, delivery.attempt_count - 1));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO chime_app.notification_attempts (
         organization_id, delivery_id, attempt_number, provider,
         provider_mode, status, error_message
       ) VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
      [
        delivery.organization_id,
        delivery.id,
        delivery.attempt_count,
        config.mode === 'sandbox' ? `sandbox-${delivery.channel}` : delivery.channel,
        config.mode,
        message.slice(0, 500),
      ],
    );
    await client.query(
      `UPDATE chime_app.notification_deliveries
       SET status = 'failed',
           last_error = $3,
           available_at = now() + ($4::text || ' seconds')::interval,
           completed_at = CASE WHEN attempt_count >= $5 THEN now() ELSE NULL END,
           claimed_at = NULL,
           claim_token = NULL,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2
         AND claim_token = $6`,
      [
        delivery.organization_id,
        delivery.id,
        message.slice(0, 500),
        delaySeconds,
        config.maxAttempts,
        delivery.claim_token,
      ],
    );
    await refreshOutbox(client, delivery.outbox_event_id, config.maxAttempts, message.slice(0, 500));
    await client.query('COMMIT');
  } catch (databaseError) {
    await client.query('ROLLBACK');
    throw databaseError;
  } finally {
    client.release();
  }
  return message;
}

export async function processNotificationBatch(
  pool: Pool,
  config = notificationConfigFromEnv(),
  organizationId: string | null = null,
): Promise<NotificationBatchResult> {
  const deliveries = await claimDeliveries(pool, config, organizationId);
  const result: NotificationBatchResult = {
    mode: config.mode,
    claimed: deliveries.length,
    sent: 0,
    failed: 0,
    deliveries: [],
  };
  for (const delivery of deliveries) {
    try {
      const message = await loadRenderedMessage(pool, delivery);
      const provider = await sendMessage(config, delivery, message);
      await finishSuccess(pool, config, delivery, provider, message);
      result.sent += 1;
      result.deliveries.push({ id: delivery.id, status: 'sent', provider: provider.provider });
    } catch (error) {
      const message = await finishFailure(pool, config, delivery, error);
      result.failed += 1;
      result.deliveries.push({
        id: delivery.id,
        status: 'failed',
        provider: config.mode === 'sandbox' ? `sandbox-${delivery.channel}` : delivery.channel,
        error: message,
      });
    }
  }
  return result;
}
