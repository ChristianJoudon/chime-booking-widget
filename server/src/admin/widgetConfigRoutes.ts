import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { requireIdempotencyKey } from './validation.js';

type JsonRecord = Record<string, unknown>;

interface WidgetConfigRow {
  id: string;
  organization_id: string;
  organization_slug: string;
  slug: string;
  theme: JsonRecord;
  copy: JsonRecord;
  locale: string;
  time_zone: string;
  is_active: boolean;
  version: number;
}

const DEFAULT_THEME = {
  primaryColor: '#42c79a',
  accentColor: '#ffd36e',
  surfaceColor: '#fffef9',
  textColor: '#102a24',
  logoVariant: 'wordmark-smile',
  cardStyle: 'soft',
  cornerStyle: 'rounded',
  fontStyle: 'modern',
  showPoweredBy: true,
};

const DEFAULT_COPY = {
  businessName: 'My business',
  headerTitle: 'Book an appointment',
  eyebrow: 'Appointment concierge',
  description: 'Choose a service, then pick the date and time that works best for you.',
  confirmationMessage: 'Your appointment is confirmed. We look forward to seeing you.',
};

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', `${field} must be an object.`);
  }
  return value as JsonRecord;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', `${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', `${field} must be ${maximum} characters or fewer.`);
  }
  return text;
}

function optionalUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = requiredText(value, 'theme.customLogoUrl', 2000);
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
  } catch {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', 'theme.customLogoUrl must be an http or https URL.');
  }
  return text;
}

function color(value: unknown, field: string, fallback: string): string {
  const text = value === undefined ? fallback : requiredText(value, field, 7);
  if (!/^#[0-9a-f]{6}$/i.test(text)) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', `${field} must be a six-digit hex color.`);
  }
  return text.toLowerCase();
}

function choice<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback: T): T {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string' || !allowed.includes(candidate as T)) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', `${field} has an unsupported value.`);
  }
  return candidate as T;
}

function parseTheme(value: unknown) {
  const input = record(value, 'theme');
  const logoVariant = choice(input.logoVariant, 'theme.logoVariant', ['wordmark', 'wordmark-smile', 'bell', 'custom', 'none'] as const, 'wordmark-smile');
  const customLogoUrl = optionalUrl(input.customLogoUrl);
  if (logoVariant === 'custom' && !customLogoUrl) {
    throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', 'A custom logo URL is required when Custom logo is selected.');
  }
  return {
    primaryColor: color(input.primaryColor, 'theme.primaryColor', DEFAULT_THEME.primaryColor),
    accentColor: color(input.accentColor, 'theme.accentColor', DEFAULT_THEME.accentColor),
    surfaceColor: color(input.surfaceColor, 'theme.surfaceColor', DEFAULT_THEME.surfaceColor),
    textColor: color(input.textColor, 'theme.textColor', DEFAULT_THEME.textColor),
    logoVariant,
    ...(customLogoUrl ? { customLogoUrl } : {}),
    cardStyle: choice(input.cardStyle, 'theme.cardStyle', ['soft', 'outline', 'solid'] as const, 'soft'),
    cornerStyle: choice(input.cornerStyle, 'theme.cornerStyle', ['soft', 'rounded', 'pill'] as const, 'rounded'),
    fontStyle: choice(input.fontStyle, 'theme.fontStyle', ['modern', 'friendly', 'classic'] as const, 'modern'),
    showPoweredBy: typeof input.showPoweredBy === 'boolean' ? input.showPoweredBy : true,
  };
}

function parseCopy(value: unknown) {
  const input = record(value, 'copy');
  return {
    businessName: requiredText(input.businessName, 'copy.businessName', 80),
    headerTitle: requiredText(input.headerTitle, 'copy.headerTitle', 100),
    eyebrow: requiredText(input.eyebrow, 'copy.eyebrow', 80),
    description: requiredText(input.description, 'copy.description', 320),
    confirmationMessage: requiredText(input.confirmationMessage, 'copy.confirmationMessage', 320),
  };
}

function expectedVersion(header: string | undefined): number {
  const normalized = header?.replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 0) {
    throw new AdminApiError(428, 'VERSION_REQUIRED', 'Widget writes require If-Match with the current version, or 0 for a new widget.');
  }
  return version;
}

function optionalUuid(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AdminApiError(400, 'INVALID_IDENTIFIER', 'config.id must be a UUID.');
  }
  return value;
}

function mapConfig(row: WidgetConfigRow) {
  return {
    id: row.id,
    organizationSlug: row.organization_slug,
    slug: row.slug,
    theme: { ...DEFAULT_THEME, ...row.theme },
    copy: { ...DEFAULT_COPY, ...row.copy },
    locale: row.locale,
    timeZone: row.time_zone,
    isActive: row.is_active,
    version: Number(row.version),
  };
}

async function readWidgetConfig(client: Pool | PoolClient, organizationId: string, id?: string | null) {
  const result = await client.query<WidgetConfigRow>(
    `SELECT config.id,
            config.organization_id,
            organization.slug AS organization_slug,
            config.slug,
            config.theme,
            config.copy,
            config.locale,
            config.time_zone,
            config.is_active,
            config.version
       FROM chime_app.widget_configs config
       JOIN chime_app.organizations organization ON organization.id = config.organization_id
      WHERE config.organization_id = $1
        AND ($2::uuid IS NULL OR config.id = $2)
      ORDER BY config.is_active DESC, config.created_at
      LIMIT 1`,
    [organizationId, id ?? null],
  );
  return result.rows[0];
}

export function createWidgetConfigRouter(pool: Pool) {
  const router = Router();

  router.get('/widget-config', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const current = await readWidgetConfig(pool, session.organizationId);
    if (current) {
      response.json({ config: mapConfig(current) });
      return;
    }

    const organization = await pool.query<{ slug: string; name: string; default_time_zone: string }>(
      `SELECT slug, name, default_time_zone FROM chime_app.organizations WHERE id = $1`,
      [session.organizationId],
    );
    const row = organization.rows[0];
    if (!row) throw new AdminApiError(404, 'ORGANIZATION_NOT_FOUND', 'The organization could not be found.');
    response.json({
      config: {
        id: null,
        organizationSlug: row.slug,
        slug: 'booking',
        theme: DEFAULT_THEME,
        copy: { ...DEFAULT_COPY, businessName: row.name, headerTitle: `Book with ${row.name}` },
        locale: 'en-US',
        timeZone: row.default_time_zone,
        // Not active: nothing is stored yet, so the public widget endpoint has
        // nothing to serve and answers 404. Reporting `true` told the studio a
        // design was live to customers when no customer could reach it. The
        // id: null and version: 0 beside it already say it was never saved.
        isActive: false,
        version: 0,
      },
    });
  }));

  router.put(
    '/widget-config',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const input = record(request.body, 'widget config');
      const id = optionalUuid(input.id);
      const slug = requiredText(input.slug, 'slug', 80).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new AdminApiError(400, 'INVALID_WIDGET_CONFIG', 'slug may contain lowercase letters, numbers, and single hyphens.');
      }
      const theme = parseTheme(input.theme);
      const copy = parseCopy(input.copy);
      const locale = requiredText(input.locale, 'locale', 20);
      const timeZone = requiredText(input.timeZone, 'timeZone', 80);
      const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;
      const version = expectedVersion(request.get('if-match'));
      const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));
      const correlationId = request.get('x-request-id') ?? randomUUID();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const replay = await client.query<{ payload: { widgetConfig?: unknown } }>(
          `SELECT payload FROM chime_app.outbox_events
            WHERE organization_id = $1 AND idempotency_key = $2`,
          [session.organizationId, idempotencyKey],
        );
        if (replay.rows[0]?.payload.widgetConfig) {
          await client.query('COMMIT');
          response.json({ config: replay.rows[0].payload.widgetConfig });
          return;
        }

        const before = await readWidgetConfig(client, session.organizationId, id);
        if (before && Number(before.version) !== version) {
          throw new AdminApiError(412, 'VERSION_CONFLICT', 'This widget design changed in another session. Reload before saving.', { currentVersion: Number(before.version) });
        }
        if (!before && version !== 0) {
          throw new AdminApiError(412, 'VERSION_CONFLICT', 'This is a new widget design. Reload before saving.', { currentVersion: 0 });
        }

        let saved: WidgetConfigRow;
        if (before) {
          const updated = await client.query<WidgetConfigRow>(
            `UPDATE chime_app.widget_configs config
                SET slug = $3,
                    theme = $4::jsonb,
                    copy = $5::jsonb,
                    locale = $6,
                    time_zone = $7,
                    is_active = $8,
                    version = config.version + 1
               FROM chime_app.organizations organization
              WHERE config.id = $1
                AND config.organization_id = $2
                AND organization.id = config.organization_id
            RETURNING config.id, config.organization_id, organization.slug AS organization_slug,
                      config.slug, config.theme, config.copy, config.locale, config.time_zone,
                      config.is_active, config.version`,
            [before.id, session.organizationId, slug, JSON.stringify(theme), JSON.stringify(copy), locale, timeZone, isActive],
          );
          if (!updated.rows[0]) throw new AdminApiError(409, 'WRITE_CONFLICT', 'The widget design could not be updated.');
          saved = updated.rows[0];
        } else {
          const created = await client.query<WidgetConfigRow>(
            `WITH inserted AS (
               INSERT INTO chime_app.widget_configs (
                 organization_id, slug, theme, copy, locale, time_zone, is_active
               ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
               RETURNING *
             )
             SELECT inserted.id, inserted.organization_id, organization.slug AS organization_slug,
                    inserted.slug, inserted.theme, inserted.copy, inserted.locale, inserted.time_zone,
                    inserted.is_active, inserted.version
               FROM inserted
               JOIN chime_app.organizations organization ON organization.id = inserted.organization_id`,
            [session.organizationId, slug, JSON.stringify(theme), JSON.stringify(copy), locale, timeZone, isActive],
          );
          if (!created.rows[0]) throw new AdminApiError(409, 'WRITE_CONFLICT', 'The widget design could not be created.');
          saved = created.rows[0];
        }

        const widgetConfig = mapConfig(saved);
        await client.query(
          `INSERT INTO chime_app.audit_events (
             organization_id, actor_kind, actor_id, action, entity_type, entity_id,
             before_state, after_state, correlation_id
           ) VALUES ($1, 'user', $2, 'widget.config.saved', 'widget_config', $3, $4::jsonb, $5::jsonb, $6)`,
          [session.organizationId, session.subject, saved.id, before ? JSON.stringify(mapConfig(before)) : null, JSON.stringify(widgetConfig), correlationId],
        );
        await client.query(
          `INSERT INTO chime_app.outbox_events (
             organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
           ) VALUES ($1, 'widget.config.updated', 'widget_config', $2, $3::jsonb, $4)`,
          [session.organizationId, saved.id, JSON.stringify({ widgetConfig }), idempotencyKey],
        );
        await client.query('COMMIT');
        response.status(before ? 200 : 201).json({ config: widgetConfig });
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505') {
          throw new AdminApiError(409, 'SLUG_CONFLICT', 'That widget URL is already in use for this business.');
        }
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  return router;
}
