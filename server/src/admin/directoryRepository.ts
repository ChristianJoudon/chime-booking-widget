import type { Pool, PoolClient } from 'pg';

import { AdminApiError } from './types.js';

export interface StaffDirectoryEntry {
  id: string;
  displayName: string;
  email: string | null;
  color: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
  version: number;
}

export interface StaffWriteInput {
  displayName: string;
  email: string | null;
  color: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
}

export interface StaffMutationContext {
  organizationId: string;
  userId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface LocationDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  address: Record<string, unknown>;
  isActive: boolean;
}

interface StaffRow {
  id: string;
  display_name: string;
  email: string | null;
  color: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  version: number;
}

interface LocationRow {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  address: Record<string, unknown>;
  is_active: boolean;
}

function mapStaff(row: StaffRow): StaffDirectoryEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    color: row.color,
    isActive: row.is_active,
    settings: row.settings ?? {},
    version: row.version,
  };
}

function locationIds(input: StaffWriteInput): string[] {
  const value = input.settings.locationIds;
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];
}

async function assertLocationsBelongToOrganization(
  client: PoolClient,
  organizationId: string,
  input: StaffWriteInput,
): Promise<void> {
  const ids = locationIds(input);
  if (!ids.length) return;

  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM chime_app.locations
      WHERE organization_id = $1
        AND id = ANY($2::uuid[])
        AND is_active = true`,
    [organizationId, ids],
  );

  if (Number(result.rows[0]?.count ?? 0) !== ids.length) {
    throw new AdminApiError(
      400,
      'STAFF_LOCATION_INVALID',
      'One or more selected locations are not available in this workspace.',
    );
  }
}

async function findIdempotentStaff(
  client: PoolClient,
  context: StaffMutationContext,
): Promise<StaffDirectoryEntry | null> {
  const result = await client.query<{ staff: StaffDirectoryEntry }>(
    `SELECT payload -> 'staff' AS staff
       FROM chime_app.outbox_events
      WHERE organization_id = $1
        AND idempotency_key = $2
        AND aggregate_type = 'staff_member'
      LIMIT 1`,
    [context.organizationId, context.idempotencyKey],
  );
  return result.rows[0]?.staff ?? null;
}

async function recordStaffMutation(
  client: PoolClient,
  context: StaffMutationContext,
  eventType: string,
  staff: StaffDirectoryEntry,
  before: StaffDirectoryEntry | null,
): Promise<void> {
  await client.query(
    `INSERT INTO chime_app.audit_events (
       organization_id, actor_kind, actor_id, action, entity_type, entity_id,
       before_state, after_state, correlation_id
     ) VALUES ($1, 'user', $2, $3, 'staff_member', $4, $5::jsonb, $6::jsonb, $7)`,
    [
      context.organizationId,
      context.userId,
      eventType,
      staff.id,
      before ? JSON.stringify(before) : null,
      JSON.stringify(staff),
      context.requestId,
    ],
  );

  await client.query(
    `INSERT INTO chime_app.outbox_events (
       organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
     ) VALUES ($1, $2, 'staff_member', $3, $4::jsonb, $5)`,
    [
      context.organizationId,
      eventType,
      staff.id,
      JSON.stringify({ staff, before }),
      context.idempotencyKey,
    ],
  );
}

export async function listStaff(
  pool: Pool,
  organizationId: string,
  includeInactive = false,
): Promise<StaffDirectoryEntry[]> {
  const result = await pool.query<StaffRow>(
    `SELECT id, display_name, email, color, is_active, settings, version
       FROM chime_app.staff_members
      WHERE organization_id = $1
        AND ($2::boolean OR is_active = true)
      ORDER BY is_active DESC, lower(display_name), id`,
    [organizationId, includeInactive],
  );
  return result.rows.map(mapStaff);
}

export async function listActiveStaff(
  pool: Pool,
  organizationId: string,
): Promise<StaffDirectoryEntry[]> {
  return listStaff(pool, organizationId, false);
}

export async function createStaff(
  pool: Pool,
  input: StaffWriteInput,
  context: StaffMutationContext,
): Promise<StaffDirectoryEntry> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await findIdempotentStaff(client, context);
    if (replay) {
      await client.query('COMMIT');
      return replay;
    }
    await assertLocationsBelongToOrganization(client, context.organizationId, input);
    const result = await client.query<StaffRow>(
      `INSERT INTO chime_app.staff_members (
         organization_id, display_name, email, color, is_active, settings
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, display_name, email, color, is_active, settings, version`,
      [
        context.organizationId,
        input.displayName,
        input.email,
        input.color,
        input.isActive,
        JSON.stringify(input.settings),
      ],
    );
    const staff = mapStaff(result.rows[0]);
    await recordStaffMutation(client, context, 'staff.created', staff, null);
    await client.query('COMMIT');
    return staff;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateStaff(
  pool: Pool,
  staffId: string,
  expectedVersion: number,
  input: StaffWriteInput,
  context: StaffMutationContext,
): Promise<StaffDirectoryEntry> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await findIdempotentStaff(client, context);
    if (replay) {
      await client.query('COMMIT');
      return replay;
    }
    const currentResult = await client.query<StaffRow>(
      `SELECT id, display_name, email, color, is_active, settings, version
         FROM chime_app.staff_members
        WHERE organization_id = $1 AND id = $2
        FOR UPDATE`,
      [context.organizationId, staffId],
    );
    if (!currentResult.rowCount) {
      throw new AdminApiError(404, 'STAFF_NOT_FOUND', 'That team member no longer exists.');
    }
    const before = mapStaff(currentResult.rows[0]);
    if (before.version !== expectedVersion) {
      throw new AdminApiError(
        409,
        'STAFF_VERSION_CONFLICT',
        'This team member changed in another session. Reload before saving.',
        { expectedVersion, currentVersion: before.version },
      );
    }
    await assertLocationsBelongToOrganization(client, context.organizationId, input);
    const result = await client.query<StaffRow>(
      `UPDATE chime_app.staff_members
          SET display_name = $3,
              email = $4,
              color = $5,
              is_active = $6,
              settings = $7::jsonb,
              version = version + 1,
              updated_at = now()
        WHERE organization_id = $1 AND id = $2
        RETURNING id, display_name, email, color, is_active, settings, version`,
      [
        context.organizationId,
        staffId,
        input.displayName,
        input.email,
        input.color,
        input.isActive,
        JSON.stringify(input.settings),
      ],
    );
    const staff = mapStaff(result.rows[0]);
    const eventType = before.isActive && !staff.isActive
      ? 'staff.deactivated'
      : !before.isActive && staff.isActive
        ? 'staff.activated'
        : 'staff.updated';
    await recordStaffMutation(client, context, eventType, staff, before);
    await client.query('COMMIT');
    return staff;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listActiveLocations(
  pool: Pool,
  organizationId: string,
): Promise<LocationDirectoryEntry[]> {
  const result = await pool.query<LocationRow>(
    `SELECT id, name, slug, time_zone, address, is_active
       FROM chime_app.locations
      WHERE organization_id = $1
        AND is_active = true
      ORDER BY lower(name), id`,
    [organizationId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    timeZone: row.time_zone,
    address: row.address,
    isActive: row.is_active,
  }));
}
