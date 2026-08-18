import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const apiBaseUrl = (process.env.CHIME_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:8888/api/chime/admin')
  .replace(/\/$/, '');
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN;
const viewerToken = process.env.CHIME_ADMIN_VIEWER_TOKEN;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://chime:chime@127.0.0.1:5534/chime';

assert(ownerToken, 'CHIME_ADMIN_OWNER_TOKEN is required.');
assert(viewerToken, 'CHIME_ADMIN_VIEWER_TOKEN is required.');

const pool = new Pool({ connectionString: databaseUrl });
const nonce = Date.now();
const ids = {
  ownerOutbox: randomUUID(),
  ownerDelivery: randomUUID(),
  failedOutbox: randomUUID(),
  failedDelivery: randomUUID(),
  foreignOutbox: randomUUID(),
  foreignDelivery: randomUUID(),
  template: randomUUID(),
};
const pausedReady = [];

async function request(path, { token = ownerToken, expected, ...options } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (expected !== undefined) {
    assert.equal(response.status, expected, `${options.method ?? 'GET'} ${path}: ${JSON.stringify(body)}`);
  } else {
    assert(response.ok, `${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { body, response };
}

const me = await request('/me');
const organizationId = me.body.user.organizationId;
const foreignOrganizationResult = await pool.query(
  'SELECT id FROM chime_app.organizations WHERE id <> $1 ORDER BY created_at LIMIT 1',
  [organizationId],
);
const foreignOrganizationId = foreignOrganizationResult.rows[0]?.id ?? null;

async function insertDelivery(outboxId, deliveryId, organization, status, recipient) {
  await pool.query(
    `INSERT INTO chime_app.outbox_events (
       id, organization_id, event_type, aggregate_type, aggregate_id,
       payload, idempotency_key, status
     ) VALUES ($1, $2, 'notification.smoke', 'smoke', $3, $4, $5, 'pending')`,
    [
      outboxId,
      organization,
      randomUUID(),
      JSON.stringify({
        customerName: 'Notification Smoke',
        serviceName: 'Quick check-in',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      `notification-smoke-outbox-${outboxId}`,
    ],
  );
  await pool.query(
    `INSERT INTO chime_app.notification_deliveries (
       id, organization_id, outbox_event_id, channel, recipient,
       template_key, idempotency_key, status, attempt_count, last_error, available_at
     ) VALUES (
       $1, $2, $3, 'email', $4, 'booking_received', $5, $6, $7, $8,
       CASE WHEN $6 = 'failed' THEN now() + interval '1 day' ELSE now() END
     )`,
    [
      deliveryId,
      organization,
      outboxId,
      recipient,
      `notification-smoke-delivery-${deliveryId}`,
      status,
      status === 'failed' ? 3 : 0,
      status === 'failed' ? 'Synthetic provider failure' : null,
    ],
  );
}

try {
  const existingReady = await pool.query(
    `SELECT id, available_at
     FROM chime_app.notification_deliveries
     WHERE organization_id = $1
       AND status IN ('pending', 'failed')
       AND available_at <= now()
     FOR UPDATE`,
    [organizationId],
  );
  pausedReady.push(...existingReady.rows);
  if (pausedReady.length) {
    await pool.query(
      `UPDATE chime_app.notification_deliveries
       SET available_at = now() + interval '2 days'
       WHERE id = ANY($1::uuid[])`,
      [pausedReady.map((row) => row.id)],
    );
  }

  await insertDelivery(
    ids.ownerOutbox,
    ids.ownerDelivery,
    organizationId,
    'pending',
    `notification-smoke-${nonce}@example.test`,
  );
  await insertDelivery(
    ids.failedOutbox,
    ids.failedDelivery,
    organizationId,
    'failed',
    `notification-failed-${nonce}@example.test`,
  );
  if (foreignOrganizationId) {
    await insertDelivery(
      ids.foreignOutbox,
      ids.foreignDelivery,
      foreignOrganizationId,
      'pending',
      `notification-foreign-${nonce}@example.test`,
    );
  }
  await pool.query(
    `INSERT INTO chime_app.notification_templates (
       id, organization_id, template_key, channel, display_name,
       subject_template, body_template
     ) VALUES ($1, $2, $3, 'email', 'Smoke template', 'Hello {{customer.name}}', 'Your {{service.name}} is ready.')`,
    [ids.template, organizationId, `notification_smoke_${nonce}`],
  );

  const initial = await request('/communications');
  assert.equal(initial.body.runtime.mode, 'sandbox', 'Tests must never contact live providers.');
  assert(initial.body.deliveries.some((item) => item.id === ids.ownerDelivery));
  assert(initial.body.deliveries.some((item) => item.id === ids.failedDelivery));
  assert.equal(initial.body.deliveries.some((item) => item.id === ids.foreignDelivery), false);

  await request('/communications/process', {
    method: 'POST',
    token: viewerToken,
    expected: 403,
  });

  const processed = await request('/communications/process', { method: 'POST' });
  assert.equal(processed.body.result.claimed, 1);
  assert.equal(processed.body.result.sent, 1);
  assert.equal(processed.body.result.mode, 'sandbox');

  const stored = await pool.query(
    `SELECT delivery.status,
       delivery.provider_message_id,
       outbox.status AS outbox_status,
       attempt.provider,
       attempt.provider_mode,
       attempt.status AS attempt_status
     FROM chime_app.notification_deliveries delivery
     JOIN chime_app.outbox_events outbox ON outbox.id = delivery.outbox_event_id
     JOIN chime_app.notification_attempts attempt ON attempt.delivery_id = delivery.id
     WHERE delivery.id = $1`,
    [ids.ownerDelivery],
  );
  assert.equal(stored.rows[0].status, 'sent');
  assert.match(stored.rows[0].provider_message_id, /^sandbox-/);
  assert.equal(stored.rows[0].outbox_status, 'published');
  assert.equal(stored.rows[0].provider, 'sandbox-email');
  assert.equal(stored.rows[0].provider_mode, 'sandbox');
  assert.equal(stored.rows[0].attempt_status, 'sent');

  await request(`/communications/${ids.failedDelivery}/retry`, { method: 'POST' });
  const retried = await pool.query(
    'SELECT status, attempt_count, last_error FROM chime_app.notification_deliveries WHERE id = $1',
    [ids.failedDelivery],
  );
  assert.equal(retried.rows[0].status, 'pending');
  assert.equal(retried.rows[0].attempt_count, 0);
  assert.equal(retried.rows[0].last_error, null);

  // Suppressing requires a stated reason, and the reason is recorded against the
  // person who gave it. Both halves are checked: sending none has to be refused,
  // and sending one has to end up on the row.
  const withoutReason = await request(`/communications/${ids.failedDelivery}/suppress`, {
    expected: 400,
    method: 'POST',
  });
  assert.equal(
    withoutReason.body?.error?.code,
    'REASON_REQUIRED',
    'Suppressing without a reason must be refused.',
  );

  const reason = 'Duplicate of an earlier message; the customer already replied.';
  await request(`/communications/${ids.failedDelivery}/suppress`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });
  const suppressed = await pool.query(
    'SELECT status, suppressed_reason, suppressed_by_user_id, suppressed_at FROM chime_app.notification_deliveries WHERE id = $1',
    [ids.failedDelivery],
  );
  assert.equal(suppressed.rows[0].status, 'suppressed');
  assert.equal(suppressed.rows[0].suppressed_reason, reason, 'The reason given must be what is stored.');
  assert.ok(suppressed.rows[0].suppressed_by_user_id, 'A suppression must name who did it.');
  assert.ok(suppressed.rows[0].suppressed_at, 'A suppression must record when.');

  const templates = await request('/communications/templates');
  const smokeTemplate = templates.body.templates.find((item) => item.id === ids.template);
  assert(smokeTemplate);
  const updated = await request(
    `/communications/templates/${encodeURIComponent(smokeTemplate.templateKey)}/email`,
    {
      method: 'PUT',
      headers: { 'If-Match': `"${smokeTemplate.version}"` },
      body: JSON.stringify({
        displayName: 'Smoke template updated',
        subjectTemplate: smokeTemplate.subjectTemplate,
        bodyTemplate: `${smokeTemplate.bodyTemplate} Updated safely.`,
        isActive: true,
      }),
    },
  );
  assert.equal(updated.body.template.version, smokeTemplate.version + 1);

  console.log(JSON.stringify({
    checks: [
      'sandbox mode prevents external delivery',
      'tenant-scoped queue visibility',
      'viewer processing denial',
      'claim and simulated provider completion',
      'attempt history and outbox publication',
      'manual retry reset',
      'manual suppression',
      'optimistic template editing',
    ],
  }, null, 2));
} finally {
  await pool.query(
    'DELETE FROM chime_app.audit_events WHERE entity_id = ANY($1::uuid[])',
    [[ids.ownerDelivery, ids.failedDelivery, ids.template]],
  );
  await pool.query(
    'DELETE FROM chime_app.notification_templates WHERE id = $1',
    [ids.template],
  );
  await pool.query(
    'DELETE FROM chime_app.notification_deliveries WHERE id = ANY($1::uuid[])',
    [[ids.ownerDelivery, ids.failedDelivery, ids.foreignDelivery]],
  );
  await pool.query(
    'DELETE FROM chime_app.outbox_events WHERE id = ANY($1::uuid[])',
    [[ids.ownerOutbox, ids.failedOutbox, ids.foreignOutbox]],
  );
  for (const row of pausedReady) {
    await pool.query(
      'UPDATE chime_app.notification_deliveries SET available_at = $2 WHERE id = $1',
      [row.id, row.available_at],
    );
  }
  await pool.end();
}
