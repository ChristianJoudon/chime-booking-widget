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

const BUSINESS_TYPES = new Set(['consulting', 'beauty', 'wellness', 'coaching', 'education', 'home_services', 'repair', 'other']);
const SERVICE_MODES = new Set(['business_location', 'mobile', 'virtual', 'mixed']);
const CONFIRMATION_MODES = new Set(['automatic', 'manual']);
const CHANGE_POLICIES = new Set(['instant', 'customer_approval', 'business_review']);
const INCREMENTS = new Set([5, 10, 15, 20, 30, 60]);

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_BUSINESS_SETTINGS', `${field} is required.`);
  }
  return value.trim().slice(0, maximum);
}

function optionalText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AdminApiError(400, 'INVALID_BUSINESS_SETTINGS', `${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function choice(value: unknown, field: string, options: Set<string>): string {
  if (typeof value !== 'string' || !options.has(value)) {
    throw new AdminApiError(400, 'INVALID_BUSINESS_SETTINGS', `${field} has an unsupported value.`);
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  return value !== false;
}

function validateTimeZone(value: unknown): string {
  const zone = requiredText(value, 'timeZone', 80);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
  } catch {
    throw new AdminApiError(400, 'INVALID_TIME_ZONE', 'Choose a recognized business time zone.');
  }
  return zone;
}

function validateEmail(value: unknown): string {
  const email = optionalText(value, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminApiError(400, 'INVALID_CONTACT_EMAIL', 'Enter a complete business email address.');
  }
  return email;
}

function validateUrl(value: unknown): string {
  const url = optionalText(value, 500);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new AdminApiError(400, 'INVALID_WEBSITE_URL', 'Website URL must begin with http:// or https://.');
  }
  return url;
}

function validateSlug(value: unknown): string {
  const slug = requiredText(value, 'bookingPageSlug', 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new AdminApiError(400, 'INVALID_BOOKING_PAGE_SLUG', 'Use lowercase letters, numbers, and single hyphens only.');
  }
  return slug;
}

function mapSettings(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id,
    businessName: row.business_name,
    publicName: row.public_name,
    businessType: row.business_type,
    serviceMode: row.service_mode,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    websiteUrl: row.website_url,
    timeZone: row.time_zone,
    currency: row.currency,
    bookingPageSlug: row.booking_page_slug,
    appointmentIncrementMinutes: Number(row.appointment_increment_minutes),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes),
    maximumAdvanceDays: Number(row.maximum_advance_days),
    confirmationMode: row.confirmation_mode,
    changePolicy: row.change_policy,
    customerCancellationAllowed: row.customer_cancellation_allowed,
    customerReschedulingAllowed: row.customer_rescheduling_allowed,
    cancellationNoticeMinutes: Number(row.cancellation_notice_minutes),
    rescheduleNoticeMinutes: Number(row.reschedule_notice_minutes),
    customerWelcomeMessage: row.customer_welcome_message,
    confirmationMessage: row.confirmation_message,
    cancellationPolicySummary: row.cancellation_policy_summary,
    version: Number(row.version),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

async function ensureSettings(pool: Pool, organizationId: string) {
  await pool.query(
    `INSERT INTO chime_app.business_settings (
       organization_id, business_name, public_name, booking_page_slug
     )
     SELECT organization.id, organization.name, organization.name,
       COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower(organization.name), '[^a-z0-9]+', '-', 'g')), ''), 'business')
         || '-' || left(organization.id::text, 8)
     FROM chime_app.organizations organization
     WHERE organization.id = $1
     ON CONFLICT (organization_id) DO NOTHING`,
    [organizationId],
  );
  const result = await pool.query(
    `SELECT * FROM chime_app.business_settings WHERE organization_id = $1`,
    [organizationId],
  );
  if (!result.rows[0]) throw new AdminApiError(404, 'BUSINESS_NOT_FOUND', 'This Chime business could not be found.');
  return result.rows[0] as Record<string, unknown>;
}

async function setupReadiness(pool: Pool, organizationId: string, settings: ReturnType<typeof mapSettings>) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM chime_app.services WHERE organization_id = $1 AND is_active = true AND is_public = true) AS services,
       (SELECT count(*)::int FROM chime_app.staff_members WHERE organization_id = $1 AND is_active = true) AS staff,
       (SELECT count(*)::int FROM chime_app.availability_rules WHERE organization_id = $1) AS availability,
       (SELECT count(*)::int FROM chime_app.locations WHERE organization_id = $1 AND is_active = true) AS locations,
       (SELECT count(*)::int FROM chime_app.widget_configs WHERE organization_id = $1) AS widgets,
       (SELECT count(*)::int FROM chime_app.notification_templates WHERE organization_id = $1 AND is_active = true) AS messages`,
    [organizationId],
  );
  const counts = result.rows[0];
  const paymentReady = Boolean(process.env.STRIPE_SECRET_KEY?.trim() || process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true');
  const profileComplete = Boolean(settings.businessName && settings.publicName && settings.contactEmail && settings.timeZone);
  const items = [
    { id: 'profile', label: 'Business profile', detail: profileComplete ? 'Customers can identify and contact you.' : 'Add a business email and public details.', complete: profileComplete, required: true },
    { id: 'services', label: 'Public service', detail: counts.services ? `${counts.services} service${counts.services === 1 ? '' : 's'} visible to customers.` : 'Publish at least one bookable service.', complete: counts.services > 0, required: true, count: counts.services },
    { id: 'team', label: 'Team coverage', detail: counts.staff ? `${counts.staff} active team member${counts.staff === 1 ? '' : 's'}.` : 'Add the person providing appointments.', complete: counts.staff > 0, required: true, count: counts.staff },
    { id: 'availability', label: 'Booking hours', detail: counts.availability ? 'Customer availability has working-hour rules.' : 'Paint the hours customers can book.', complete: counts.availability > 0, required: true, count: counts.availability },
    { id: 'widget', label: 'Customer widget', detail: counts.widgets ? 'A customer-facing widget configuration exists.' : 'Save the customer widget design.', complete: counts.widgets > 0, required: true, count: counts.widgets },
    { id: 'messages', label: 'Customer messages', detail: counts.messages ? `${counts.messages} active message template${counts.messages === 1 ? '' : 's'}.` : 'Activate customer confirmation messages.', complete: counts.messages > 0, required: true, count: counts.messages },
    { id: 'payments', label: 'Customer deposits', detail: paymentReady ? 'A payment provider is available.' : 'Optional for businesses offering paid deposits.', complete: paymentReady, required: false },
  ];
  const required = items.filter((item) => item.required);
  const completed = required.filter((item) => item.complete).length;
  return {
    score: Math.round((completed / required.length) * 100),
    completed,
    total: required.length,
    launchReady: completed === required.length,
    items,
  };
}

async function payload(pool: Pool, organizationId: string) {
  const row = await ensureSettings(pool, organizationId);
  const settings = mapSettings(row);
  return { settings, setup: await setupReadiness(pool, organizationId, settings) };
}

export function createBusinessSettingsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/business-settings', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    response.json(await payload(pool, session.organizationId));
  }));

  router.put(
    '/business-settings',
    requireRoles('owner', 'admin'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const expectedVersion = parseExpectedVersion(request.get('if-match'));
      const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));
      const current = await ensureSettings(pool, session.organizationId);
      if (current.last_idempotency_key === idempotencyKey) {
        response.json(await payload(pool, session.organizationId));
        return;
      }
      const currency = requiredText(request.body?.currency, 'currency', 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new AdminApiError(400, 'INVALID_CURRENCY', 'Currency must use a three-letter code such as USD.');
      }
      const increment = integer(request.body?.appointmentIncrementMinutes, 'appointmentIncrementMinutes', 5, 60);
      if (!INCREMENTS.has(increment)) {
        throw new AdminApiError(400, 'INVALID_INCREMENT', 'Choose a 5, 10, 15, 20, 30, or 60 minute appointment increment.');
      }
      try {
        const result = await pool.query(
          `UPDATE chime_app.business_settings
           SET business_name = $4,
               public_name = $5,
               business_type = $6,
               service_mode = $7,
               contact_email = $8,
               contact_phone = $9,
               website_url = $10,
               time_zone = $11,
               currency = $12,
               booking_page_slug = $13,
               appointment_increment_minutes = $14,
               minimum_notice_minutes = $15,
               maximum_advance_days = $16,
               confirmation_mode = $17,
               change_policy = $18,
               customer_cancellation_allowed = $19,
               customer_rescheduling_allowed = $20,
               cancellation_notice_minutes = $21,
               reschedule_notice_minutes = $22,
               customer_welcome_message = $23,
               confirmation_message = $24,
               cancellation_policy_summary = $25,
               last_idempotency_key = $3,
               version = version + 1,
               updated_at = now()
           WHERE organization_id = $1 AND version = $2
           RETURNING *`,
          [
            session.organizationId,
            expectedVersion,
            idempotencyKey,
            requiredText(request.body?.businessName, 'businessName', 140),
            requiredText(request.body?.publicName, 'publicName', 140),
            choice(request.body?.businessType, 'businessType', BUSINESS_TYPES),
            choice(request.body?.serviceMode, 'serviceMode', SERVICE_MODES),
            validateEmail(request.body?.contactEmail),
            optionalText(request.body?.contactPhone, 60),
            validateUrl(request.body?.websiteUrl),
            validateTimeZone(request.body?.timeZone),
            currency,
            validateSlug(request.body?.bookingPageSlug),
            increment,
            integer(request.body?.minimumNoticeMinutes, 'minimumNoticeMinutes', 0, 10080),
            integer(request.body?.maximumAdvanceDays, 'maximumAdvanceDays', 1, 730),
            choice(request.body?.confirmationMode, 'confirmationMode', CONFIRMATION_MODES),
            choice(request.body?.changePolicy, 'changePolicy', CHANGE_POLICIES),
            booleanValue(request.body?.customerCancellationAllowed),
            booleanValue(request.body?.customerReschedulingAllowed),
            integer(request.body?.cancellationNoticeMinutes, 'cancellationNoticeMinutes', 0, 43200),
            integer(request.body?.rescheduleNoticeMinutes, 'rescheduleNoticeMinutes', 0, 43200),
            requiredText(request.body?.customerWelcomeMessage, 'customerWelcomeMessage', 500),
            requiredText(request.body?.confirmationMessage, 'confirmationMessage', 500),
            requiredText(request.body?.cancellationPolicySummary, 'cancellationPolicySummary', 1000),
          ],
        );
        const settings = result.rows[0];
        if (!settings) {
          throw new AdminApiError(409, 'BUSINESS_SETTINGS_VERSION_CONFLICT', 'These business settings changed in another session. Refresh before saving again.');
        }
        await pool.query(
          `INSERT INTO chime_app.audit_events (
             organization_id, actor_kind, actor_id, action,
             entity_type, entity_id, after_state, correlation_id
           ) VALUES ($1, 'user', $2, 'business.settings_updated', 'business_settings', $1, $3, $4)`,
          [
            session.organizationId,
            session.subject,
            JSON.stringify({ version: settings.version, publicName: settings.public_name }),
            request.chimeRequestId ?? randomUUID(),
          ],
        );
        await pool.query(
          `INSERT INTO chime_app.outbox_events (
             organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
           ) VALUES ($1, 'business.settings_updated', 'organization', $1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [
            session.organizationId,
            JSON.stringify({ organizationId: session.organizationId, version: settings.version }),
            `business-settings:${idempotencyKey}`,
          ],
        );
      } catch (error) {
        if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
          throw new AdminApiError(409, 'BOOKING_PAGE_SLUG_TAKEN', 'That booking-page address is already in use. Choose another.');
        }
        throw error;
      }
      response.setHeader('ETag', `"${expectedVersion + 1}"`);
      response.json(await payload(pool, session.organizationId));
    }),
  );

  return router;
}
