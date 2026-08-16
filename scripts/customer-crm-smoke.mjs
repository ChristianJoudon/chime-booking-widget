import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');
const baseUrl = process.env.CHIME_ADMIN_API_BASE_URL ?? process.env.CHIME_ADMIN_API_URL ?? process.env.CHIME_ADMIN_BASE_URL ?? 'http://127.0.0.1:8888';
const apiUrl = baseUrl.replace(/\/+$/, '').endsWith('/api/chime/admin')
  ? baseUrl.replace(/\/+$/, '')
  : `${baseUrl.replace(/\/+$/, '')}/api/chime/admin`;
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN ?? process.env.CHIME_OWNER_TOKEN ?? process.env.OWNER_TOKEN;
const viewerToken = process.env.CHIME_ADMIN_VIEWER_TOKEN ?? process.env.CHIME_VIEWER_TOKEN ?? process.env.VIEWER_TOKEN;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://chime:chime@127.0.0.1:5534/chime';

assert(ownerToken, 'An owner token is required.');
assert(viewerToken, 'A viewer token is required.');

const pool = new Pool({ connectionString: databaseUrl });

const request = async (path, { token = ownerToken, method = 'GET', body, version } = {}) => {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(version ? { 'if-match': String(version) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
};

const testEmail = `customer-crm-${Date.now()}@example.invalid`;
const testPhone = `+1808${String(Date.now()).slice(-7)}`;
let customerId;
let tagId;
let noteId;
let appointmentId;
let deliveryId;
let foreignCustomerId;

try {
  const me = await request('/me');
  assert.equal(me.response.status, 200);
  const organizationId = me.payload.user.organizationId;

  const created = await request('/customers', {
    method: 'POST',
    body: { displayName: 'CRM Smoke Customer', email: testEmail, phone: testPhone },
  });
  assert.equal(created.response.status, 201);
  customerId = created.payload.customer.id;
  assert.equal(created.payload.customer.version, 1);

  const foreignOrganization = await pool.query(
    `SELECT id FROM chime_app.organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`,
    [organizationId],
  );
  if (foreignOrganization.rowCount) {
    foreignCustomerId = randomUUID();
    await pool.query(
      `INSERT INTO chime_app.customers (
         id, organization_id, display_name, email, time_zone, lifecycle_status,
         preferred_channel, email_notifications_enabled, sms_notifications_enabled, version
       ) VALUES ($1, $2, 'Foreign CRM Customer', $3, 'UTC', 'active', 'email', true, true, 1)`,
      [foreignCustomerId, foreignOrganization.rows[0].id, `foreign-${testEmail}`],
    );
  }

  const directory = await request('/customers?search=CRM%20Smoke');
  assert.equal(directory.response.status, 200);
  assert(directory.payload.customers.some((customer) => customer.id === customerId));
  assert(!directory.payload.customers.some((customer) => customer.id === foreignCustomerId));

  const viewerDirectory = await request('/customers', { token: viewerToken });
  assert.equal(viewerDirectory.response.status, 200);
  const viewerWrite = await request(`/customers/${customerId}`, {
    token: viewerToken,
    method: 'PUT',
    version: 1,
    body: { displayName: 'Viewer must not edit' },
  });
  assert.equal(viewerWrite.response.status, 403);

  const tag = await request('/customers/tags', {
    method: 'POST',
    body: { name: `Smoke ${String(Date.now()).slice(-6)}`, color: '#5f927f' },
  });
  assert.equal(tag.response.status, 201);
  tagId = tag.payload.tag.id;

  const assigned = await request(`/customers/${customerId}/tags`, {
    method: 'PUT',
    body: { tagIds: [tagId] },
  });
  assert.equal(assigned.response.status, 200);
  assert.deepEqual(assigned.payload.tags.map((entry) => entry.id), [tagId]);

  const note = await request(`/customers/${customerId}/notes`, {
    method: 'POST',
    body: { body: 'Synthetic note for the customer CRM smoke test.' },
  });
  assert.equal(note.response.status, 201);
  noteId = note.payload.note.id;

  const service = await pool.query(
    `SELECT id, default_duration_minutes FROM chime_app.services
     WHERE organization_id = $1 AND is_active = true ORDER BY created_at LIMIT 1`,
    [organizationId],
  );
  assert(service.rowCount, 'The smoke tenant needs one active service.');
  appointmentId = randomUUID();
  const startsAt = new Date(Date.now() + 3 * 86400000);
  const endsAt = new Date(startsAt.valueOf() + Number(service.rows[0].default_duration_minutes) * 60000);
  await pool.query(
    `INSERT INTO chime_app.appointments (
       id, organization_id, reference_code, service_id, customer_id, starts_at, ends_at,
       time_zone, status, source, confirmation_mode, change_approval_mode, custom_answers, version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pacific/Honolulu', 'confirmed',
       'admin', 'automatic', 'business', '{}'::jsonb, 1)`,
    [appointmentId, organizationId, `CRM-${String(Date.now()).slice(-8)}`, service.rows[0].id, customerId, startsAt, endsAt],
  );

  deliveryId = randomUUID();
  await pool.query(
    `INSERT INTO chime_app.notification_deliveries (
       id, organization_id, channel, recipient, template_key, idempotency_key,
       status, metadata, available_at
     ) VALUES ($1, $2, 'email', $3, 'booking_received', $4, 'pending', $5::jsonb, now())`,
    [deliveryId, organizationId, testEmail, `crm-smoke-${deliveryId}`, JSON.stringify({ customerId, appointmentId })],
  );

  const updated = await request(`/customers/${customerId}`, {
    method: 'PUT',
    version: created.payload.customer.version,
    body: {
      displayName: 'CRM Smoke Customer Updated',
      email: testEmail,
      phone: testPhone,
      lifecycleStatus: 'vip',
      preferredChannel: 'sms',
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: true,
      marketingConsent: true,
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.customer.version, 2);
  assert.equal(updated.payload.customer.lifecycleStatus, 'vip');

  const suppressed = await pool.query(
    `SELECT status FROM chime_app.notification_deliveries WHERE id = $1`,
    [deliveryId],
  );
  assert.equal(suppressed.rows[0].status, 'suppressed');

  const stale = await request(`/customers/${customerId}`, {
    method: 'PUT',
    version: 1,
    body: { displayName: 'Stale write' },
  });
  assert.equal(stale.response.status, 409);

  const profile = await request(`/customers/${customerId}`);
  assert.equal(profile.response.status, 200);
  assert(profile.payload.appointments.some((appointment) => appointment.id === appointmentId));
  assert(profile.payload.notes.some((entry) => entry.id === noteId));
  assert(profile.payload.communications.some((entry) => entry.id === deliveryId));
  assert(profile.payload.customer.tags.some((entry) => entry.id === tagId));

  const deletedNote = await request(`/customers/${customerId}/notes/${noteId}`, { method: 'DELETE' });
  assert.equal(deletedNote.response.status, 204);
  noteId = undefined;

  console.log(JSON.stringify({
    checks: [
      'customer create and searchable directory',
      'tenant-scoped customer visibility',
      'viewer read access and write denial',
      'business-defined customer tags',
      'private staff notes',
      'appointment and communication timeline',
      'contact preference queue suppression',
      'optimistic customer profile updates',
      'stale profile write rejection',
    ],
  }, null, 2));
} finally {
  if (noteId) await pool.query(`DELETE FROM chime_app.customer_notes WHERE id = $1`, [noteId]);
  if (deliveryId) await pool.query(`DELETE FROM chime_app.notification_deliveries WHERE id = $1`, [deliveryId]);
  if (appointmentId) await pool.query(`DELETE FROM chime_app.appointments WHERE id = $1`, [appointmentId]);
  if (customerId) await pool.query(`DELETE FROM chime_app.customers WHERE id = $1`, [customerId]);
  if (tagId) await pool.query(`DELETE FROM chime_app.customer_tags WHERE id = $1`, [tagId]);
  if (foreignCustomerId) await pool.query(`DELETE FROM chime_app.customers WHERE id = $1`, [foreignCustomerId]);
  await pool.end();
}
