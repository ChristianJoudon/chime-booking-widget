import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';

import { getAdminSession, requireRoles } from './auth.js';
import {
  createAvailabilityException,
  deleteAvailabilityException,
  listAvailabilityExceptions,
  previewAvailability,
  publishAvailability,
  type AvailabilityMutationContext,
} from './availabilityEngine.js';
import { AdminApiError } from './types.js';
import { parseUuid, requireIdempotencyKey } from './validation.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function horizonDays(value: unknown): number {
  const source = isRecord(value) ? value.horizonDays : undefined;
  const parsed = source === undefined ? 30 : Number(source);
  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 90) {
    throw new AdminApiError(400, 'AVAILABILITY_HORIZON_INVALID', 'Choose a publishing window from 7 to 90 days.');
  }
  return parsed;
}

function mutationContext(request: Parameters<typeof getAdminSession>[0]): AvailabilityMutationContext {
  const session = getAdminSession(request);
  return {
    organizationId: session.organizationId,
    userId: session.subject,
    requestId: request.chimeRequestId ?? randomUUID(),
    idempotencyKey: requireIdempotencyKey(request.get('idempotency-key')),
  };
}

export function createAvailabilityRouter(pool: Pool): Router {
  const router = Router();

  router.post('/availability/preview', async (request, response, next) => {
    try {
      const session = getAdminSession(request);
      const summary = await previewAvailability(pool, session.organizationId, horizonDays(request.body));
      response.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  router.post('/availability/publish', requireRoles('owner', 'admin', 'manager'), async (request, response, next) => {
    try {
      const summary = await publishAvailability(pool, horizonDays(request.body), mutationContext(request));
      response.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  router.get('/staff/:staffId/exceptions', async (request, response, next) => {
    try {
      const session = getAdminSession(request);
      const exceptions = await listAvailabilityExceptions(
        pool,
        session.organizationId,
        parseUuid(request.params.staffId, 'staffId'),
      );
      response.json({ exceptions });
    } catch (error) {
      next(error);
    }
  });

  router.post('/staff/:staffId/exceptions', requireRoles('owner', 'admin', 'manager'), async (request, response, next) => {
    try {
      if (!isRecord(request.body)) {
        throw new AdminApiError(400, 'AVAILABILITY_EXCEPTION_INVALID', 'Time-off details are required.');
      }
      const startDate = typeof request.body.startDate === 'string' ? request.body.startDate : '';
      const endDate = typeof request.body.endDate === 'string' ? request.body.endDate : '';
      const reason = typeof request.body.reason === 'string' && request.body.reason.trim()
        ? request.body.reason.trim().slice(0, 200)
        : null;
      const exception = await createAvailabilityException(
        pool,
        parseUuid(request.params.staffId, 'staffId'),
        startDate,
        endDate,
        reason,
        mutationContext(request),
      );
      response.status(201).json({ exception });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/staff/:staffId/exceptions/:exceptionId', requireRoles('owner', 'admin', 'manager'), async (request, response, next) => {
    try {
      await deleteAvailabilityException(
        pool,
        parseUuid(request.params.staffId, 'staffId'),
        parseUuid(request.params.exceptionId, 'exceptionId'),
        mutationContext(request),
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
