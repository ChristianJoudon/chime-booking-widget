import { randomUUID } from 'node:crypto';

import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Pool } from 'pg';

import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, requireIdempotencyKey } from './validation.js';

const DISPLAY_MODES = new Set(['inline', 'modal', 'floating_button']);

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_LAUNCH_SETTINGS', `${field} is required.`);
  }
  return value.trim().slice(0, maximum);
}

function validateUrl(value: unknown, field: string): string {
  const url = requiredText(value, field, 1000);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new AdminApiError(400, 'INVALID_LAUNCH_URL', `${field} must be a complete http:// or https:// address.`);
  }
  return url;
}

function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_EMBED_DOMAIN', 'Each allowed domain must contain a website hostname.');
  }
  const raw = value.trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  const candidate = wildcard ? raw.slice(2) : raw;
  let host = '';
  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('parts');
    }
    host = parsed.host;
  } catch {
    throw new AdminApiError(400, 'INVALID_EMBED_DOMAIN', `“${raw}” is not a valid website domain.`);
  }
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host) || host.includes('..')) {
    throw new AdminApiError(400, 'INVALID_EMBED_DOMAIN', `“${raw}” is not a valid website domain.`);
  }
  return `${wildcard ? '*.' : ''}${host}`;
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 25) {
    throw new AdminApiError(400, 'TOO_MANY_EMBED_DOMAINS', 'Chime supports up to 25 allowed domains per business.');
  }
  return [...new Set(value.map(normalizeDomain))];
}

function mapSettings(row: Record<string, unknown>) {
  return {
    organizationId: String(row.organization_id),
    publicBusinessId: String(row.public_business_id),
    embedEnabled: row.embed_enabled === true,
    hostedPageEnabled: row.hosted_page_enabled === true,
    displayMode: String(row.display_mode) as 'inline' | 'modal' | 'floating_button',
    buttonLabel: String(row.button_label),
    allowAnyDomain: row.allow_any_domain === true,
    allowedDomains: Array.isArray(row.allowed_domains) ? row.allowed_domains.map(String) : [],
    loaderUrl: String(row.loader_url),
    stylesheetUrl: String(row.stylesheet_url),
    hostedBaseUrl: String(row.hosted_base_url),
    apiBaseUrl: String(row.api_base_url),
    publishedAt: row.published_at
      ? row.published_at instanceof Date ? row.published_at.toISOString() : String(row.published_at)
      : null,
    version: Number(row.version),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

async function ensureLaunchSettings(pool: Pool, organizationId: string) {
  await pool.query(
    `INSERT INTO chime_app.launch_settings (organization_id, public_business_id)
     VALUES ($1::uuid, 'biz_' || replace($1::uuid::text, '-', ''))
     ON CONFLICT (organization_id) DO NOTHING`,
    [organizationId],
  );
  const result = await pool.query(
    `SELECT * FROM chime_app.launch_settings WHERE organization_id = $1`,
    [organizationId],
  );
  if (!result.rows[0]) throw new AdminApiError(404, 'LAUNCH_SETTINGS_NOT_FOUND', 'This Chime launch profile could not be found.');
  return result.rows[0] as Record<string, unknown>;
}

async function launchReadiness(pool: Pool, organizationId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM chime_app.services WHERE organization_id = $1 AND is_active = true AND is_public = true) AS services,
       (SELECT count(*)::int FROM chime_app.staff_members WHERE organization_id = $1 AND is_active = true) AS staff,
       (SELECT count(*)::int FROM chime_app.availability_rules WHERE organization_id = $1) AS availability,
       (SELECT count(*)::int FROM chime_app.widget_configs WHERE organization_id = $1) AS widgets`,
    [organizationId],
  );
  const counts = result.rows[0] ?? {};
  const checks = [
    {
      id: 'services',
      label: 'Public service',
      detail: Number(counts.services) > 0 ? `${counts.services} bookable service${Number(counts.services) === 1 ? '' : 's'} ready.` : 'Publish at least one customer-facing service.',
      complete: Number(counts.services) > 0,
    },
    {
      id: 'team',
      label: 'Team coverage',
      detail: Number(counts.staff) > 0 ? `${counts.staff} active team member${Number(counts.staff) === 1 ? '' : 's'} available.` : 'Add the person who will provide appointments.',
      complete: Number(counts.staff) > 0,
    },
    {
      id: 'availability',
      label: 'Booking hours',
      detail: Number(counts.availability) > 0 ? 'Working-hour rules are ready for customer booking.' : 'Add availability before opening the widget.',
      complete: Number(counts.availability) > 0,
    },
    {
      id: 'widget',
      label: 'Widget design',
      detail: Number(counts.widgets) > 0 ? 'A saved customer widget design is ready.' : 'Save the customer-facing design first.',
      complete: Number(counts.widgets) > 0,
    },
  ];
  const completed = checks.filter((check) => check.complete).length;
  return {
    ready: completed === checks.length,
    score: Math.round((completed / checks.length) * 100),
    completed,
    total: checks.length,
    checks,
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function snippet(
  settings: ReturnType<typeof mapSettings>,
  displayMode: 'inline' | 'modal' | 'floating_button',
  publicName: string,
): string {
  const configuration = {
    businessName: publicName,
    api: { baseUrl: settings.apiBaseUrl },
  };
  return [
    `<!-- Chime booking widget -->`,
    `<link rel="stylesheet" href="${escapeAttribute(settings.stylesheetUrl)}">`,
    `<div data-chime-widget`,
    `  data-chime-business="${escapeAttribute(settings.publicBusinessId)}"`,
    `  data-chime-display="${displayMode}"`,
    `  data-chime-button-label="${escapeAttribute(settings.buttonLabel)}"></div>`,
    `<script>`,
    `  window.CHIME_WIDGET_CONFIG = ${safeScriptJson(configuration)};`,
    `</script>`,
    `<script async src="${escapeAttribute(settings.loaderUrl)}"></script>`,
  ].join('\n');
}

function hostedUrl(settings: ReturnType<typeof mapSettings>, publicName: string): string {
  const url = new URL(settings.hostedBaseUrl);
  url.searchParams.set('business', settings.publicBusinessId);
  url.searchParams.set('name', publicName);
  url.searchParams.set('api', settings.apiBaseUrl);
  return url.toString();
}

async function launchPayload(pool: Pool, organizationId: string) {
  const row = await ensureLaunchSettings(pool, organizationId);
  const settings = mapSettings(row);
  const [readiness, businessResult, installationsResult] = await Promise.all([
    launchReadiness(pool, organizationId),
    pool.query(
      `SELECT COALESCE(settings.public_name, organization.name) AS public_name
       FROM chime_app.organizations organization
       LEFT JOIN chime_app.business_settings settings ON settings.organization_id = organization.id
       WHERE organization.id = $1`,
      [organizationId],
    ),
    pool.query(
      `SELECT id, domain, status, first_seen_at, last_seen_at, last_widget_version
       FROM chime_app.embed_installations
       WHERE organization_id = $1
       ORDER BY last_seen_at DESC
       LIMIT 25`,
      [organizationId],
    ),
  ]);
  const publicName = String(businessResult.rows[0]?.public_name ?? 'Your business');
  return {
    settings,
    readiness,
    snippets: {
      inline: snippet(settings, 'inline', publicName),
      modal: snippet(settings, 'modal', publicName),
      floatingButton: snippet(settings, 'floating_button', publicName),
    },
    hosted: {
      enabled: settings.hostedPageEnabled,
      url: hostedUrl(settings, publicName),
    },
    installations: installationsResult.rows.map((installation) => ({
      id: String(installation.id),
      domain: String(installation.domain),
      status: String(installation.status) as 'pending' | 'verified' | 'attention',
      firstSeenAt: installation.first_seen_at instanceof Date ? installation.first_seen_at.toISOString() : String(installation.first_seen_at),
      lastSeenAt: installation.last_seen_at instanceof Date ? installation.last_seen_at.toISOString() : String(installation.last_seen_at),
      widgetVersion: installation.last_widget_version ? String(installation.last_widget_version) : null,
    })),
  };
}

export function createLaunchRouter(pool: Pool): Router {
  const router = Router();

  router.get('/launch', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    response.json(await launchPayload(pool, session.organizationId));
  }));

  router.put(
    '/launch',
    requireRoles('owner', 'admin'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const expectedVersion = parseExpectedVersion(request.get('if-match'));
      const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));
      const current = await ensureLaunchSettings(pool, session.organizationId);
      if (current.last_idempotency_key === idempotencyKey) {
        response.json(await launchPayload(pool, session.organizationId));
        return;
      }

      const displayMode = requiredText(request.body?.displayMode, 'displayMode', 32);
      if (!DISPLAY_MODES.has(displayMode)) {
        throw new AdminApiError(400, 'INVALID_DISPLAY_MODE', 'Choose inline, modal, or floating button.');
      }
      const allowedDomains = normalizeDomains(request.body?.allowedDomains);
      const allowAnyDomain = request.body?.allowAnyDomain === true;
      const embedEnabled = request.body?.embedEnabled === true;
      const hostedPageEnabled = request.body?.hostedPageEnabled !== false;
      const readiness = await launchReadiness(pool, session.organizationId);
      if ((embedEnabled || hostedPageEnabled) && !readiness.ready) {
        throw new AdminApiError(409, 'LAUNCH_NOT_READY', 'Finish the required launch checks before opening Chime to customers.', readiness);
      }
      if (embedEnabled && !allowAnyDomain && allowedDomains.length === 0) {
        throw new AdminApiError(400, 'EMBED_DOMAIN_REQUIRED', 'Add at least one allowed website or explicitly allow any domain.');
      }

      const result = await pool.query(
        `UPDATE chime_app.launch_settings
         SET embed_enabled = $4,
             hosted_page_enabled = $5,
             display_mode = $6,
             button_label = $7,
             allow_any_domain = $8,
             allowed_domains = $9,
             loader_url = $10,
             stylesheet_url = $11,
             hosted_base_url = $12,
             api_base_url = $13,
             published_at = CASE WHEN $4 OR $5 THEN COALESCE(published_at, now()) ELSE published_at END,
             last_idempotency_key = $3,
             version = version + 1,
             updated_at = now()
         WHERE organization_id = $1 AND version = $2
         RETURNING *`,
        [
          session.organizationId,
          expectedVersion,
          idempotencyKey,
          embedEnabled,
          hostedPageEnabled,
          displayMode,
          requiredText(request.body?.buttonLabel, 'buttonLabel', 80),
          allowAnyDomain,
          allowedDomains,
          validateUrl(request.body?.loaderUrl, 'loaderUrl'),
          validateUrl(request.body?.stylesheetUrl, 'stylesheetUrl'),
          validateUrl(request.body?.hostedBaseUrl, 'hostedBaseUrl'),
          validateUrl(request.body?.apiBaseUrl, 'apiBaseUrl'),
        ],
      );
      if (!result.rows[0]) {
        throw new AdminApiError(409, 'LAUNCH_SETTINGS_VERSION_CONFLICT', 'Launch settings changed in another session. Refresh before saving again.');
      }

      await pool.query(
        `INSERT INTO chime_app.audit_events (
           organization_id, actor_kind, actor_id, action,
           entity_type, entity_id, after_state, correlation_id
         ) VALUES ($1, 'user', $2, 'launch.settings_updated', 'launch_settings', $1, $3, $4)`,
        [
          session.organizationId,
          session.subject,
          JSON.stringify({ version: result.rows[0].version, embedEnabled, hostedPageEnabled, displayMode }),
          request.chimeRequestId ?? randomUUID(),
        ],
      );
      await pool.query(
        `INSERT INTO chime_app.outbox_events (
           organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
         ) VALUES ($1, 'launch.settings_updated', 'organization', $1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [
          session.organizationId,
          JSON.stringify({ organizationId: session.organizationId, version: result.rows[0].version, embedEnabled, hostedPageEnabled }),
          `launch-settings:${idempotencyKey}`,
        ],
      );

      response.setHeader('ETag', `"${expectedVersion + 1}"`);
      response.json(await launchPayload(pool, session.organizationId));
    }),
  );

  return router;
}
