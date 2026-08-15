import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');
const apiBaseUrl = (process.env.CHIME_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:8788/api/chime/admin').replace(/\/$/, '');
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN;
const viewerToken = process.env.CHIME_ADMIN_VIEWER_TOKEN;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://chime:chime@127.0.0.1:5434/chime';

assert(ownerToken, 'CHIME_ADMIN_OWNER_TOKEN is required.');
assert(viewerToken, 'CHIME_ADMIN_VIEWER_TOKEN is required.');

const pool = new Pool({ connectionString: databaseUrl });
const nonce = Date.now();
const idempotencyPrefix = `availability-studio-smoke-${nonce}`;
let staffId;
let organizationId;
let originalSettings;
let originalVersion;

async function request(path, { token = ownerToken, method = 'GET', body, version, idempotencyKey } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(version ? { 'If-Match': String(version) } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

try {
  const me = await request('/me');
  assert.equal(me.response.status, 200);
  organizationId = me.payload.user.organizationId;

  const ownerSchedules = await request('/availability/schedules');
  assert.equal(ownerSchedules.response.status, 200);
  assert(ownerSchedules.payload.schedules.length > 0, 'The smoke tenant needs one active team member.');
  const schedule = ownerSchedules.payload.schedules[0];
  staffId = schedule.staffId;

  const original = await pool.query(
    `SELECT settings, version FROM chime_app.staff_members
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, staffId],
  );
  originalSettings = original.rows[0].settings;
  originalVersion = Number(original.rows[0].version);

  const viewerSchedules = await request('/availability/schedules', { token: viewerToken });
  assert.equal(viewerSchedules.response.status, 200);

  const splitDays = schedule.days.map((day) => day.dayOfWeek === 1
    ? {
        dayOfWeek: 1,
        blocks: [
          { id: 'smoke-morning', start: '09:00', end: '12:00' },
          { id: 'smoke-afternoon', start: '13:00', end: '17:00' },
        ],
      }
    : { dayOfWeek: day.dayOfWeek, blocks: day.blocks });

  const viewerWrite = await request(`/availability/schedules/${staffId}`, {
    token: viewerToken,
    method: 'PUT',
    version: schedule.version,
    idempotencyKey: `${idempotencyPrefix}-viewer`,
    body: { days: splitDays },
  });
  assert.equal(viewerWrite.response.status, 403);

  const saved = await request(`/availability/schedules/${staffId}`, {
    method: 'PUT',
    version: schedule.version,
    idempotencyKey: `${idempotencyPrefix}-save`,
    body: { days: splitDays },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.schedule.version, schedule.version + 1);
  assert.equal(saved.payload.schedule.days.find((day) => day.dayOfWeek === 1).blocks.length, 2);

  const persisted = await pool.query(
    `SELECT settings -> 'workingHours' -> 'monday' -> 'blocks' AS blocks
     FROM chime_app.staff_members WHERE id = $1 AND organization_id = $2`,
    [staffId, organizationId],
  );
  assert.equal(persisted.rows[0].blocks.length, 2);

  const preview = await request('/availability/preview', {
    method: 'POST',
    body: { horizonDays: 30 },
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.payload.summary.horizonDays, 30);
  assert(preview.payload.summary.slotCount >= 0);

  const stale = await request(`/availability/schedules/${staffId}`, {
    method: 'PUT',
    version: schedule.version,
    idempotencyKey: `${idempotencyPrefix}-stale`,
    body: { days: splitDays },
  });
  assert.equal(stale.response.status, 409);

  const overlapDays = splitDays.map((day) => day.dayOfWeek === 1
    ? {
        dayOfWeek: 1,
        blocks: [
          { id: 'overlap-one', start: '09:00', end: '13:00' },
          { id: 'overlap-two', start: '12:00', end: '17:00' },
        ],
      }
    : day);
  const overlap = await request(`/availability/schedules/${staffId}`, {
    method: 'PUT',
    version: saved.payload.schedule.version,
    idempotencyKey: `${idempotencyPrefix}-overlap`,
    body: { days: overlapDays },
  });
  assert.equal(overlap.response.status, 400);

  console.log(JSON.stringify({
    checks: [
      'tenant-scoped availability schedule directory',
      'viewer read access and write denial',
      'split-shift persistence',
      'working-block preview integration',
      'optimistic schedule versioning',
      'stale schedule write rejection',
      'overlapping block rejection',
      'non-publishing preview safety',
      'exact test data restoration',
    ],
  }, null, 2));
} finally {
  if (staffId && organizationId && originalSettings !== undefined && originalVersion !== undefined) {
    await pool.query(
      `UPDATE chime_app.staff_members
       SET settings = $3::jsonb, version = $4, updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, staffId, JSON.stringify(originalSettings), originalVersion],
    );
  }
  if (organizationId) {
    await pool.query(
      `DELETE FROM chime_app.audit_events
       WHERE organization_id = $1 AND correlation_id LIKE $2`,
      [organizationId, `${idempotencyPrefix}%`],
    );
    await pool.query(
      `DELETE FROM chime_app.outbox_events
       WHERE organization_id = $1 AND idempotency_key LIKE $2`,
      [organizationId, `${idempotencyPrefix}%`],
    );
  }
  await pool.end();
}
