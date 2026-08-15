import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';

import { getAdminSession, requireRoles } from './auth.js';
import {
  createStaff,
  listActiveLocations,
  listStaff,
  updateStaff,
  type StaffMutationContext,
  type StaffWriteInput,
} from './directoryRepository.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, parseUuid, requireIdempotencyKey } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSettings(value: unknown): Record<string, unknown> {
  const source = value === undefined ? {} : value;
  if (!isRecord(source)) {
    throw new AdminApiError(400, 'STAFF_SETTINGS_INVALID', 'Team settings must be an object.');
  }
  const role = typeof source.role === 'string' && source.role.trim()
    ? source.role.trim().slice(0, 80)
    : 'Team member';
  const rawLocations = source.locationIds ?? [];
  if (!Array.isArray(rawLocations) || rawLocations.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    throw new AdminApiError(400, 'STAFF_LOCATIONS_INVALID', 'Team locations must contain valid location IDs.');
  }
  const rawHours = source.workingHours ?? {};
  if (!isRecord(rawHours)) {
    throw new AdminApiError(400, 'STAFF_HOURS_INVALID', 'Working hours must be an object.');
  }
  const workingHours: Record<string, { enabled: boolean; start: string; end: string }> = {};
  for (const day of DAYS) {
    const rawDay = rawHours[day];
    const dayValue = isRecord(rawDay) ? rawDay : {};
    const enabled = typeof dayValue.enabled === 'boolean'
      ? dayValue.enabled
      : !['saturday', 'sunday'].includes(day);
    const start = typeof dayValue.start === 'string' ? dayValue.start : '09:00';
    const end = typeof dayValue.end === 'string' ? dayValue.end : '17:00';
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start >= end) {
      throw new AdminApiError(400, 'STAFF_HOURS_INVALID', `${day} needs a valid start and end time.`);
    }
    workingHours[day] = { enabled, start, end };
  }
  return {
    role,
    locationIds: [...new Set(rawLocations)],
    workingHours,
  };
}

function parseStaffInput(value: unknown): StaffWriteInput {
  if (!isRecord(value)) {
    throw new AdminApiError(400, 'STAFF_INPUT_INVALID', 'Team member details are required.');
  }
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
  if (!displayName || displayName.length > 120) {
    throw new AdminApiError(400, 'STAFF_NAME_INVALID', 'Enter a team member name under 120 characters.');
  }
  const email = typeof value.email === 'string' && value.email.trim()
    ? value.email.trim().toLowerCase()
    : null;
  if (email && (!email.includes('@') || email.length > 254)) {
    throw new AdminApiError(400, 'STAFF_EMAIL_INVALID', 'Enter a valid email address.');
  }
  const color = typeof value.color === 'string' ? value.color : null;
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new AdminApiError(400, 'STAFF_COLOR_INVALID', 'Choose a six-digit color value.');
  }
  return {
    displayName,
    email,
    color,
    isActive: typeof value.isActive === 'boolean' ? value.isActive : true,
    settings: parseSettings(value.settings),
  };
}

function mutationContext(request: Parameters<typeof getAdminSession>[0]): StaffMutationContext {
  const session = getAdminSession(request);
  return {
    organizationId: session.organizationId,
    userId: session.subject,
    requestId: request.chimeRequestId ?? randomUUID(),
    idempotencyKey: requireIdempotencyKey(request.get('idempotency-key')),
  };
}

export function createDirectoryRouter(pool: Pool): Router {
  const router = Router();

  router.get('/staff', async (request, response, next) => {
    try {
      const session = getAdminSession(request);
      const staff = await listStaff(pool, session.organizationId, request.query.includeInactive === 'true');
      response.json({ staff });
    } catch (error) {
      next(error);
    }
  });

  router.post('/staff', requireRoles('owner', 'admin', 'manager'), async (request, response, next) => {
    try {
      const staff = await createStaff(pool, parseStaffInput(request.body), mutationContext(request));
      response.setHeader('ETag', `"${staff.version}"`);
      response.status(201).json({ staff });
    } catch (error) {
      next(error);
    }
  });

  router.put('/staff/:staffId', requireRoles('owner', 'admin', 'manager'), async (request, response, next) => {
    try {
      const staff = await updateStaff(
        pool,
        parseUuid(request.params.staffId, 'staffId'),
        parseExpectedVersion(request.get('if-match')),
        parseStaffInput(request.body),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${staff.version}"`);
      response.json({ staff });
    } catch (error) {
      next(error);
    }
  });

  router.get('/locations', async (request, response, next) => {
    try {
      const session = getAdminSession(request);
      const locations = await listActiveLocations(pool, session.organizationId);
      response.json({ locations });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
