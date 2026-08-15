import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';

import { availabilityBlocks, type AvailabilityWorkingBlock } from './availabilityEngine.js';
import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, parseUuid, requireIdempotencyKey } from './validation.js';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface StaffScheduleRow {
  id: string;
  display_name: string;
  color: string;
  settings: Record<string, unknown>;
  version: number;
}

interface ScheduleDayInput {
  dayOfWeek: number;
  blocks: AvailabilityWorkingBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function minutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

function parseBlocks(value: unknown, dayOfWeek: number): AvailabilityWorkingBlock[] {
  if (!Array.isArray(value)) {
    throw new AdminApiError(400, 'AVAILABILITY_BLOCKS_INVALID', `${DAY_LABELS[dayOfWeek]} needs a list of working blocks.`);
  }
  if (value.length > 4) {
    throw new AdminApiError(400, 'AVAILABILITY_BLOCKS_LIMIT', `${DAY_LABELS[dayOfWeek]} can contain up to four working blocks.`);
  }
  const blocks = value.map((raw) => {
    if (!isRecord(raw)) {
      throw new AdminApiError(400, 'AVAILABILITY_BLOCK_INVALID', `${DAY_LABELS[dayOfWeek]} contains an invalid block.`);
    }
    const start = typeof raw.start === 'string' ? raw.start.slice(0, 5) : '';
    const end = typeof raw.end === 'string' ? raw.end.slice(0, 5) : '';
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
      throw new AdminApiError(400, 'AVAILABILITY_TIME_INVALID', `Choose valid times for ${DAY_LABELS[dayOfWeek]}.`);
    }
    if (minutes(end) - minutes(start) < 30 || minutes(start) % 15 || minutes(end) % 15) {
      throw new AdminApiError(400, 'AVAILABILITY_INCREMENT_INVALID', `${DAY_LABELS[dayOfWeek]} blocks must be at least 30 minutes and use 15-minute increments.`);
    }
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : randomUUID(),
      start,
      end,
    };
  }).sort((left, right) => minutes(left.start) - minutes(right.start));
  blocks.forEach((block, index) => {
    if (index > 0 && minutes(block.start) < minutes(blocks[index - 1].end)) {
      throw new AdminApiError(400, 'AVAILABILITY_OVERLAP', `${DAY_LABELS[dayOfWeek]} working blocks cannot overlap.`);
    }
  });
  return blocks;
}

function parseDays(value: unknown): ScheduleDayInput[] {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new AdminApiError(400, 'AVAILABILITY_WEEK_INVALID', 'Send all seven days when saving a weekly schedule.');
  }
  const days = value.map((raw) => {
    if (!isRecord(raw) || !Number.isInteger(raw.dayOfWeek) || Number(raw.dayOfWeek) < 0 || Number(raw.dayOfWeek) > 6) {
      throw new AdminApiError(400, 'AVAILABILITY_DAY_INVALID', 'Every schedule day needs a valid day number.');
    }
    const dayOfWeek = Number(raw.dayOfWeek);
    return { dayOfWeek, blocks: parseBlocks(raw.blocks, dayOfWeek) };
  }).sort((left, right) => left.dayOfWeek - right.dayOfWeek);
  if (new Set(days.map((day) => day.dayOfWeek)).size !== 7) {
    throw new AdminApiError(400, 'AVAILABILITY_DAY_DUPLICATE', 'Each day may appear only once.');
  }
  return days;
}

function scheduleDto(row: StaffScheduleRow, timeZone: string) {
  const blocksByDay = availabilityBlocks(row.settings);
  return {
    staffId: row.id,
    displayName: row.display_name,
    color: row.color,
    timeZone,
    version: Number(row.version),
    days: DAY_KEYS.map((key, dayOfWeek) => ({
      dayOfWeek,
      key,
      label: DAY_LABELS[dayOfWeek],
      blocks: blocksByDay[key],
    })),
  };
}

async function organizationTimeZone(client: Pool | PoolClient, organizationId: string): Promise<string> {
  const result = await client.query<{ time_zone: string }>(
    `SELECT time_zone FROM chime_app.locations
     WHERE organization_id = $1 AND is_active = TRUE
     ORDER BY created_at LIMIT 1`,
    [organizationId],
  );
  return result.rows[0]?.time_zone ?? 'UTC';
}

export function createAvailabilityScheduleRouter(pool: Pool): Router {
  const router = Router();

  router.get('/availability/schedules', async (request, response, next) => {
    try {
      const session = getAdminSession(request);
      const [staff, timeZone] = await Promise.all([
        pool.query<StaffScheduleRow>(
          `SELECT id::text, display_name, color, settings, version
           FROM chime_app.staff_members
           WHERE organization_id = $1 AND is_active = TRUE
           ORDER BY display_name`,
          [session.organizationId],
        ),
        organizationTimeZone(pool, session.organizationId),
      ]);
      response.json({ schedules: staff.rows.map((row) => scheduleDto(row, timeZone)) });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/availability/schedules/:staffId',
    requireRoles('owner', 'admin', 'manager'),
    async (request, response, next) => {
      const client = await pool.connect();
      try {
        const session = getAdminSession(request);
        const staffId = parseUuid(request.params.staffId, 'staffId');
        const version = parseExpectedVersion(request.get('if-match'));
        const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));
        const requestId = request.chimeRequestId ?? randomUUID();
        const days = parseDays(isRecord(request.body) ? request.body.days : undefined);
        await client.query('BEGIN');
        const replay = await client.query<{ schedule: ReturnType<typeof scheduleDto> }>(
          `SELECT payload -> 'schedule' AS schedule
           FROM chime_app.outbox_events
           WHERE organization_id = $1 AND idempotency_key = $2
             AND event_type = 'availability.schedule.updated'`,
          [session.organizationId, idempotencyKey],
        );
        if (replay.rows[0]?.schedule) {
          await client.query('COMMIT');
          response.json({ schedule: replay.rows[0].schedule });
          return;
        }
        const current = await client.query<StaffScheduleRow>(
          `SELECT id::text, display_name, color, settings, version
           FROM chime_app.staff_members
           WHERE organization_id = $1 AND id = $2
           FOR UPDATE`,
          [session.organizationId, staffId],
        );
        if (!current.rows[0]) {
          throw new AdminApiError(404, 'STAFF_NOT_FOUND', 'That team member no longer exists.');
        }
        if (Number(current.rows[0].version) !== version) {
          throw new AdminApiError(409, 'STAFF_VERSION_CONFLICT', 'This schedule changed in another session. Refresh and try again.');
        }
        const currentSettings = isRecord(current.rows[0].settings) ? current.rows[0].settings : {};
        const currentWorkingHours = isRecord(currentSettings.workingHours) ? currentSettings.workingHours : {};
        const workingHours = { ...currentWorkingHours } as Record<string, unknown>;
        for (const day of days) {
          const key = DAY_KEYS[day.dayOfWeek];
          const existingDay = isRecord(currentWorkingHours[key]) ? currentWorkingHours[key] : {};
          const first = day.blocks[0];
          const last = day.blocks[day.blocks.length - 1];
          workingHours[key] = {
            ...existingDay,
            enabled: Boolean(day.blocks.length),
            start: first?.start ?? '09:00',
            end: last?.end ?? '17:00',
            blocks: day.blocks,
          };
        }
        const nextSettings = { ...currentSettings, workingHours };
        const updated = await client.query<StaffScheduleRow>(
          `UPDATE chime_app.staff_members
           SET settings = $4::jsonb, version = version + 1, updated_at = now()
           WHERE organization_id = $1 AND id = $2 AND version = $3
           RETURNING id::text, display_name, color, settings, version`,
          [session.organizationId, staffId, version, JSON.stringify(nextSettings)],
        );
        if (!updated.rows[0]) {
          throw new AdminApiError(409, 'STAFF_VERSION_CONFLICT', 'This schedule changed in another session. Refresh and try again.');
        }
        const timeZone = await organizationTimeZone(client, session.organizationId);
        const schedule = scheduleDto(updated.rows[0], timeZone);
        await client.query(
          `INSERT INTO chime_app.audit_events (
             organization_id, actor_kind, actor_id, action, entity_type, entity_id,
             before_state, after_state, correlation_id
           ) VALUES ($1, 'user', $2, 'availability.schedule.updated', 'staff_member', $3,
             $4::jsonb, $5::jsonb, $6)`,
          [session.organizationId, session.subject, staffId, JSON.stringify(scheduleDto(current.rows[0], timeZone)), JSON.stringify(schedule), requestId],
        );
        await client.query(
          `INSERT INTO chime_app.outbox_events (
             organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
           ) VALUES ($1, 'availability.schedule.updated', 'staff_member', $2, $3::jsonb, $4)`,
          [session.organizationId, staffId, JSON.stringify({ schedule }), idempotencyKey],
        );
        await client.query('COMMIT');
        response.setHeader('ETag', `"${schedule.version}"`);
        response.json({ schedule });
      } catch (error) {
        await client.query('ROLLBACK');
        next(error);
      } finally {
        client.release();
      }
    },
  );

  return router;
}
