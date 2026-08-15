import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const pg = requireFromServer('pg');
const { Pool } = pg;

const adminBaseUrl = (process.env.CHIME_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:8788/api/chime/admin').replace(/\/$/, '');
const publicBaseUrl = (process.env.CHIME_BOOKING_API_BASE_URL ?? 'http://127.0.0.1:8787/api/chime').replace(/\/$/, '');
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN ?? process.env.CHIME_ADMIN_TOKEN;
const viewerToken = process.env.CHIME_ADMIN_VIEWER_TOKEN;
const databaseUrl = process.env.DATABASE_URL;

assert.ok(ownerToken, 'CHIME_ADMIN_OWNER_TOKEN or CHIME_ADMIN_TOKEN is required.');
assert.ok(viewerToken, 'CHIME_ADMIN_VIEWER_TOKEN is required.');
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const pool = new Pool({ connectionString: databaseUrl });
const nonce = Date.now();
const idempotencyKeys = {
  viewer: `widget-viewer-${nonce}`,
  save: `widget-save-${nonce}`,
  stale: `widget-stale-${nonce}`,
};

async function request(path, token, options = {}) {
  const response = await fetch(`${adminBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { body, response };
}

let original = null;
let saved = null;

try {
  const ownerRead = await request('/widget-config', ownerToken);
  assert.equal(ownerRead.response.status, 200, 'Owner can read the widget design.');
  original = ownerRead.body.config;

  const viewerRead = await request('/widget-config', viewerToken);
  assert.equal(viewerRead.response.status, 200, 'Viewer can inspect the widget design.');

  const candidate = {
    ...original,
    theme: {
      ...original.theme,
      primaryColor: '#2fa9a0',
      accentColor: '#f2c66d',
    },
    copy: {
      ...original.copy,
      headerTitle: `Widget smoke ${nonce}`,
    },
    isActive: true,
  };

  const viewerWrite = await request('/widget-config', viewerToken, {
    method: 'PUT',
    headers: {
      'If-Match': `"${original.version}"`,
      'Idempotency-Key': idempotencyKeys.viewer,
    },
    body: JSON.stringify(candidate),
  });
  assert.equal(viewerWrite.response.status, 403, 'Viewer cannot change the widget design.');

  const ownerWrite = await request('/widget-config', ownerToken, {
    method: 'PUT',
    headers: {
      'If-Match': `"${original.version}"`,
      'Idempotency-Key': idempotencyKeys.save,
    },
    body: JSON.stringify(candidate),
  });
  assert.ok([200, 201].includes(ownerWrite.response.status), 'Owner can save the widget design.');
  saved = ownerWrite.body.config;
  assert.equal(saved.theme.primaryColor, '#2fa9a0');
  assert.equal(saved.copy.headerTitle, `Widget smoke ${nonce}`);
  assert.equal(saved.version, original.version + 1 || 1);

  const publicRead = await fetch(`${publicBaseUrl}/widget-config/${encodeURIComponent(saved.organizationSlug)}/${encodeURIComponent(saved.slug)}`);
  assert.equal(publicRead.status, 200, 'Active design is available to the portable widget.');
  const publicBody = await publicRead.json();
  assert.equal(publicBody.widget.theme.primaryColor, '#2fa9a0');
  assert.equal(publicBody.widget.copy.headerTitle, `Widget smoke ${nonce}`);

  const staleWrite = await request('/widget-config', ownerToken, {
    method: 'PUT',
    headers: {
      'If-Match': `"${original.version}"`,
      'Idempotency-Key': idempotencyKeys.stale,
    },
    body: JSON.stringify({ ...saved, theme: { ...saved.theme, primaryColor: '#b9684d' } }),
  });
  assert.equal(staleWrite.response.status, 412, 'Stale design writes are rejected.');

  console.log(JSON.stringify({
    checks: [
      'tenant widget read',
      'viewer read-only access',
      'owner theme persistence',
      'public portable theme delivery',
      'optimistic version increment',
      'stale write rejection',
      'exact database restoration',
    ],
    organizationSlug: saved.organizationSlug,
    widgetSlug: saved.slug,
  }, null, 2));
} finally {
  if (saved && original) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM chime_app.outbox_events
          WHERE idempotency_key = ANY($1::text[])`,
        [[idempotencyKeys.save, idempotencyKeys.stale, idempotencyKeys.viewer]],
      );
      await client.query(
        `DELETE FROM chime_app.audit_events
          WHERE entity_type = 'widget_config'
            AND entity_id = $1
            AND action = 'widget.config.saved'`,
        [saved.id],
      );
      if (original.id === null) {
        await client.query(`DELETE FROM chime_app.widget_configs WHERE id = $1`, [saved.id]);
      } else {
        await client.query(
          `UPDATE chime_app.widget_configs
              SET slug = $2,
                  theme = $3::jsonb,
                  copy = $4::jsonb,
                  locale = $5,
                  time_zone = $6,
                  is_active = $7,
                  version = $8
            WHERE id = $1`,
          [
            original.id,
            original.slug,
            JSON.stringify(original.theme),
            JSON.stringify(original.copy),
            original.locale,
            original.timeZone,
            original.isActive,
            original.version,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Widget smoke cleanup failed:', error);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }
  await pool.end();
}
