import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { findIdempotentService, recordServiceMutation } from './audit.js';
import {
  AdminApiError,
  type AdminServiceDto,
  type ServiceMutationContext,
  type ServiceWriteInput,
} from './types.js';

interface ServiceRow extends QueryResultRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  default_duration_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
  duration_increment_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  maximum_advance_days: number;
  price_minor: number;
  currency: string;
  deposit_mode: AdminServiceDto['deposit']['mode'];
  deposit_amount_minor: number | null;
  deposit_percentage: string | number | null;
  confirmation_mode: AdminServiceDto['confirmationMode'];
  change_approval_mode: AdminServiceDto['changeApprovalMode'];
  capacity: number;
  custom_questions: unknown[];
  settings: Record<string, unknown>;
  is_active: boolean;
  is_public: boolean;
  origin: AdminServiceDto['origin'];
  version: number;
  location_ids: string[];
  staff_ids: string[];
  resource_ids: string[];
}

type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const SERVICE_SELECT = `
  SELECT s.*,
         COALESCE((
           SELECT jsonb_agg(sl.location_id::text ORDER BY sl.location_id::text)
             FROM chime_app.service_locations sl
            WHERE sl.organization_id = s.organization_id AND sl.service_id = s.id
         ), '[]'::jsonb) AS location_ids,
         COALESCE((
           SELECT jsonb_agg(ss.staff_member_id::text ORDER BY ss.staff_member_id::text)
             FROM chime_app.service_staff ss
            WHERE ss.organization_id = s.organization_id AND ss.service_id = s.id
         ), '[]'::jsonb) AS staff_ids,
         COALESCE((
           SELECT jsonb_agg(sr.resource_id::text ORDER BY sr.resource_id::text)
             FROM chime_app.service_resources sr
            WHERE sr.organization_id = s.organization_id AND sr.service_id = s.id
         ), '[]'::jsonb) AS resource_ids
    FROM chime_app.services s`;

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function recordFromRow(row: ServiceRow): AdminServiceDto {
  const settings = row.settings ?? {};
  const bookingWindow = (settings.bookingWindow ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationIds: row.location_ids ?? [],
    name: row.name,
    slug: row.slug,
    shortDescription: row.short_description ?? undefined,
    category: typeof settings.category === 'string' ? settings.category : 'General',
    tone: settings.tone === 'sky' || settings.tone === 'peach' || settings.tone === 'lemon' ? settings.tone : 'mint',
    glyph: settings.glyph === 'return' || settings.glyph === 'bolt' || settings.glyph === 'sparkles' ? settings.glyph : 'chat',
    duration: {
      defaultMinutes: numberValue(row.default_duration_minutes),
      minimumMinutes: numberValue(row.minimum_duration_minutes),
      maximumMinutes: numberValue(row.maximum_duration_minutes),
      incrementMinutes: numberValue(row.duration_increment_minutes),
    },
    buffers: {
      beforeMinutes: numberValue(row.buffer_before_minutes),
      afterMinutes: numberValue(row.buffer_after_minutes),
    },
    bookingWindow: {
      minimumNoticeMinutes: numberValue(row.minimum_notice_minutes),
      maximumAdvanceDays: numberValue(row.maximum_advance_days),
      cancellationNoticeMinutes: numberValue(bookingWindow.cancellationNoticeMinutes) || undefined,
      rescheduleNoticeMinutes: numberValue(bookingWindow.rescheduleNoticeMinutes) || undefined,
    },
    priceMinor: numberValue(row.price_minor),
    currency: row.currency,
    deposit: {
      mode: row.deposit_mode,
      currency: row.currency,
      fixedAmountMinor: row.deposit_amount_minor === null ? undefined : numberValue(row.deposit_amount_minor),
      percentage: row.deposit_percentage === null ? undefined : numberValue(row.deposit_percentage),
      refundable: settings.depositRefundable !== false,
    },
    confirmationMode: row.confirmation_mode,
    changeApprovalMode: row.change_approval_mode,
    capacity: numberValue(row.capacity),
    staffIds: row.staff_ids ?? [],
    resourceIds: row.resource_ids ?? [],
    customQuestions: Array.isArray(row.custom_questions) ? row.custom_questions : [],
    isActive: row.is_active,
    isPublic: row.is_public,
    origin: row.origin,
    version: numberValue(row.version),
  };
}

function settingsFor(input: ServiceWriteInput): Record<string, unknown> {
  return {
    category: input.category,
    tone: input.tone,
    glyph: input.glyph,
    depositRefundable: input.deposit.refundable,
    bookingWindow: {
      cancellationNoticeMinutes: input.bookingWindow.cancellationNoticeMinutes,
      rescheduleNoticeMinutes: input.bookingWindow.rescheduleNoticeMinutes,
    },
  };
}

async function findService(
  executor: QueryExecutor,
  organizationId: string,
  serviceId: string,
): Promise<AdminServiceDto | null> {
  const result = await executor.query<ServiceRow>(
    `${SERVICE_SELECT} WHERE s.organization_id = $1 AND s.id = $2`,
    [organizationId, serviceId],
  );
  return result.rows[0] ? recordFromRow(result.rows[0]) : null;
}

async function syncRelationships(
  client: PoolClient,
  organizationId: string,
  serviceId: string,
  input: ServiceWriteInput,
) {
  await client.query(
    `DELETE FROM chime_app.service_locations WHERE organization_id = $1 AND service_id = $2`,
    [organizationId, serviceId],
  );
  await client.query(
    `DELETE FROM chime_app.service_staff WHERE organization_id = $1 AND service_id = $2`,
    [organizationId, serviceId],
  );
  await client.query(
    `DELETE FROM chime_app.service_resources WHERE organization_id = $1 AND service_id = $2`,
    [organizationId, serviceId],
  );

  if (input.locationIds.length) {
    await client.query(
      `INSERT INTO chime_app.service_locations (organization_id, service_id, location_id)
       SELECT $1, $2, value FROM unnest($3::uuid[]) AS value`,
      [organizationId, serviceId, input.locationIds],
    );
  }
  if (input.staffIds.length) {
    await client.query(
      `INSERT INTO chime_app.service_staff (organization_id, service_id, staff_member_id)
       SELECT $1, $2, value FROM unnest($3::uuid[]) AS value`,
      [organizationId, serviceId, input.staffIds],
    );
  }
  if (input.resourceIds.length) {
    await client.query(
      `INSERT INTO chime_app.service_resources (organization_id, service_id, resource_id)
       SELECT $1, $2, value FROM unnest($3::uuid[]) AS value`,
      [organizationId, serviceId, input.resourceIds],
    );
  }
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class ServiceRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Automated smoke runs write real service rows. They are excluded unless a
   * caller explicitly asks, so "Smoke service 1786779379821 updated" stops
   * appearing in the business service directory.
   */
  async list(organizationId: string, includeTest = false): Promise<AdminServiceDto[]> {
    const result = await this.pool.query<ServiceRow>(
      `${SERVICE_SELECT}
        WHERE s.organization_id = $1
          AND ($2::boolean OR s.origin <> 'test')
        ORDER BY s.is_active DESC, s.name ASC`,
      [organizationId, includeTest],
    );
    return result.rows.map(recordFromRow);
  }

  async get(organizationId: string, serviceId: string): Promise<AdminServiceDto> {
    const service = await findService(this.pool, organizationId, serviceId);
    if (!service) throw new AdminApiError(404, 'SERVICE_NOT_FOUND', 'Service was not found.');
    return service;
  }

  async create(input: ServiceWriteInput, context: ServiceMutationContext): Promise<AdminServiceDto> {
    return inTransaction(this.pool, async (client) => {
      const replay = await findIdempotentService(client, context, 'service.created');
      if (replay) return replay;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chime_app.services (
           organization_id, name, slug, short_description,
           default_duration_minutes, minimum_duration_minutes, maximum_duration_minutes,
           duration_increment_minutes, buffer_before_minutes, buffer_after_minutes,
           minimum_notice_minutes, maximum_advance_days, price_minor, currency,
           deposit_mode, deposit_amount_minor, deposit_percentage,
           confirmation_mode, change_approval_mode, capacity,
           custom_questions, settings, is_active, is_public, origin
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20,
           $21::jsonb, $22::jsonb, $23, $24, $25
         ) RETURNING id`,
        [
          context.organizationId,
          input.name,
          input.slug,
          input.shortDescription ?? null,
          input.duration.defaultMinutes,
          input.duration.minimumMinutes,
          input.duration.maximumMinutes,
          input.duration.incrementMinutes,
          input.buffers.beforeMinutes,
          input.buffers.afterMinutes,
          input.bookingWindow.minimumNoticeMinutes,
          input.bookingWindow.maximumAdvanceDays,
          input.priceMinor,
          input.currency,
          input.deposit.mode,
          input.deposit.fixedAmountMinor ?? null,
          input.deposit.percentage ?? null,
          input.confirmationMode,
          input.changeApprovalMode,
          input.capacity,
          JSON.stringify(input.customQuestions),
          JSON.stringify(settingsFor(input)),
          input.isActive,
          input.isPublic,
          input.origin,
        ],
      );
      const serviceId = inserted.rows[0].id;
      await syncRelationships(client, context.organizationId, serviceId, input);
      const service = await findService(client, context.organizationId, serviceId);
      if (!service) throw new Error('Created service could not be read back.');
      await recordServiceMutation(client, context, {
        action: 'service.created',
        eventType: 'service.created',
        service,
        before: null,
      });
      return service;
    });
  }

  async update(
    serviceId: string,
    expectedVersion: number,
    input: ServiceWriteInput,
    context: ServiceMutationContext,
  ): Promise<AdminServiceDto> {
    return inTransaction(this.pool, async (client) => {
      const replay = await findIdempotentService(client, context, 'service.updated');
      if (replay) return replay;

      const locked = await client.query<{ version: number }>(
        `SELECT version FROM chime_app.services
          WHERE organization_id = $1 AND id = $2
          FOR UPDATE`,
        [context.organizationId, serviceId],
      );
      const currentVersion = locked.rows[0]?.version;
      if (!currentVersion) throw new AdminApiError(404, 'SERVICE_NOT_FOUND', 'Service was not found.');
      if (Number(currentVersion) !== expectedVersion) {
        throw new AdminApiError(409, 'SERVICE_VERSION_CONFLICT', 'Service changed in another session. Refresh before saving.', {
          expectedVersion,
          currentVersion: Number(currentVersion),
        });
      }

      const before = await findService(client, context.organizationId, serviceId);
      if (!before) throw new AdminApiError(404, 'SERVICE_NOT_FOUND', 'Service was not found.');

      await client.query(
        `UPDATE chime_app.services
            SET name = $3,
                slug = $4,
                short_description = $5,
                default_duration_minutes = $6,
                minimum_duration_minutes = $7,
                maximum_duration_minutes = $8,
                duration_increment_minutes = $9,
                buffer_before_minutes = $10,
                buffer_after_minutes = $11,
                minimum_notice_minutes = $12,
                maximum_advance_days = $13,
                price_minor = $14,
                currency = $15,
                deposit_mode = $16,
                deposit_amount_minor = $17,
                deposit_percentage = $18,
                confirmation_mode = $19,
                change_approval_mode = $20,
                capacity = $21,
                custom_questions = $22::jsonb,
                settings = $23::jsonb,
                is_active = $24,
                is_public = $25,
                version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [
          context.organizationId,
          serviceId,
          input.name,
          input.slug,
          input.shortDescription ?? null,
          input.duration.defaultMinutes,
          input.duration.minimumMinutes,
          input.duration.maximumMinutes,
          input.duration.incrementMinutes,
          input.buffers.beforeMinutes,
          input.buffers.afterMinutes,
          input.bookingWindow.minimumNoticeMinutes,
          input.bookingWindow.maximumAdvanceDays,
          input.priceMinor,
          input.currency,
          input.deposit.mode,
          input.deposit.fixedAmountMinor ?? null,
          input.deposit.percentage ?? null,
          input.confirmationMode,
          input.changeApprovalMode,
          input.capacity,
          JSON.stringify(input.customQuestions),
          JSON.stringify(settingsFor(input)),
          input.isActive,
          input.isPublic,
        ],
      );
      await syncRelationships(client, context.organizationId, serviceId, input);
      const service = await findService(client, context.organizationId, serviceId);
      if (!service) throw new Error('Updated service could not be read back.');
      await recordServiceMutation(client, context, {
        action: 'service.updated',
        eventType: 'service.updated',
        service,
        before,
      });
      return service;
    });
  }

  async archive(
    serviceId: string,
    expectedVersion: number,
    context: ServiceMutationContext,
  ): Promise<AdminServiceDto> {
    return inTransaction(this.pool, async (client) => {
      const replay = await findIdempotentService(client, context, 'service.archived');
      if (replay) return replay;

      const locked = await client.query<{ version: number }>(
        `SELECT version FROM chime_app.services
          WHERE organization_id = $1 AND id = $2
          FOR UPDATE`,
        [context.organizationId, serviceId],
      );
      const currentVersion = locked.rows[0]?.version;
      if (!currentVersion) throw new AdminApiError(404, 'SERVICE_NOT_FOUND', 'Service was not found.');
      if (Number(currentVersion) !== expectedVersion) {
        throw new AdminApiError(409, 'SERVICE_VERSION_CONFLICT', 'Service changed in another session. Refresh before archiving.');
      }

      const before = await findService(client, context.organizationId, serviceId);
      if (!before) throw new AdminApiError(404, 'SERVICE_NOT_FOUND', 'Service was not found.');
      await client.query(
        `UPDATE chime_app.services
            SET is_active = false, is_public = false, version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, serviceId],
      );
      const service = await findService(client, context.organizationId, serviceId);
      if (!service) throw new Error('Archived service could not be read back.');
      await recordServiceMutation(client, context, {
        action: 'service.archived',
        eventType: 'service.archived',
        service,
        before,
      });
      return service;
    });
  }
}
