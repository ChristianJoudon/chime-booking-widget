import { createDirectoryRouter } from './directoryRoutes.js';
import { createAvailabilityRouter } from './availabilityRoutes.js';
import { createOperationsRouter } from './operationsRoutes.js';
import { createCommunicationRouter } from './communicationRoutes.js';
import { createCustomerRouter } from './customerRoutes.js';
import { randomUUID } from 'node:crypto';

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';

import { getAdminSession, requireRoles } from './auth.js';
import { ServiceRepository } from './serviceRepository.js';
import type { ServiceMutationContext } from './types.js';
import {
  parseExpectedVersion,
  parseServiceWriteInput,
  parseUuid,
  requireIdempotencyKey,
} from './validation.js';

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

function mutationContext(request: Request): ServiceMutationContext {
  const session = getAdminSession(request);
  return {
    organizationId: session.organizationId,
    userId: session.subject,
    requestId: request.chimeRequestId ?? randomUUID(),
    idempotencyKey: requireIdempotencyKey(request.get('idempotency-key')),
  };
}

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  router.use(createDirectoryRouter(pool));
  router.use(createAvailabilityRouter(pool));
  router.use(createOperationsRouter(pool));
  router.use(createCommunicationRouter(pool));
  router.use(createCustomerRouter(pool));
  const services = new ServiceRepository(pool);

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/me', (request, response) => {
    const session = getAdminSession(request);
    response.json({
      user: {
        id: session.subject,
        email: session.email,
        organizationId: session.organizationId,
        role: session.role,
      },
    });
  });

  router.get('/services', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    response.json({ services: await services.list(session.organizationId) });
  }));

  router.get('/services/:serviceId', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const service = await services.get(
      session.organizationId,
      parseUuid(request.params.serviceId, 'serviceId'),
    );
    response.setHeader('ETag', `"${service.version}"`);
    response.json({ service });
  }));

  router.post(
    '/services',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const service = await services.create(
        parseServiceWriteInput(request.body),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${service.version}"`);
      response.status(201).json({ service });
    }),
  );

  router.put(
    '/services/:serviceId',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const service = await services.update(
        parseUuid(request.params.serviceId, 'serviceId'),
        parseExpectedVersion(request.get('if-match')),
        parseServiceWriteInput(request.body),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${service.version}"`);
      response.json({ service });
    }),
  );

  router.delete(
    '/services/:serviceId',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const service = await services.archive(
        parseUuid(request.params.serviceId, 'serviceId'),
        parseExpectedVersion(request.get('if-match')),
        mutationContext(request),
      );
      response.setHeader('ETag', `"${service.version}"`);
      response.json({ service });
    }),
  );

  return router;
}
