import type { PoolClient } from 'pg';

import type { AdminServiceDto, ServiceMutationContext } from './types.js';

export async function findIdempotentService(
  client: PoolClient,
  context: ServiceMutationContext,
  eventType: string,
): Promise<AdminServiceDto | null> {
  const existing = await client.query<{ service: AdminServiceDto }>(
    `SELECT payload -> 'service' AS service
       FROM chime_app.outbox_events
      WHERE organization_id = $1
        AND idempotency_key = $2
        AND event_type = $3
      LIMIT 1`,
    [context.organizationId, context.idempotencyKey, eventType],
  );
  return existing.rows[0]?.service ?? null;
}

export async function recordServiceMutation(
  client: PoolClient,
  context: ServiceMutationContext,
  options: {
    action: string;
    eventType: string;
    service: AdminServiceDto;
    before: AdminServiceDto | null;
  },
) {
  await client.query(
    `INSERT INTO chime_app.audit_events (
       organization_id,
       actor_kind,
       actor_id,
       action,
       entity_type,
       entity_id,
       before_state,
       after_state,
       correlation_id
     ) VALUES ($1, 'user', $2, $3, 'service', $4, $5::jsonb, $6::jsonb, $7)`,
    [
      context.organizationId,
      context.userId,
      options.action,
      options.service.id,
      options.before ? JSON.stringify(options.before) : null,
      JSON.stringify(options.service),
      context.requestId,
    ],
  );

  await client.query(
    `INSERT INTO chime_app.outbox_events (
       organization_id,
       event_type,
       aggregate_type,
       aggregate_id,
       payload,
       idempotency_key
     ) VALUES ($1, $2, 'service', $3, $4::jsonb, $5)`,
    [
      context.organizationId,
      options.eventType,
      options.service.id,
      JSON.stringify({
        service: options.service,
        actorUserId: context.userId,
        requestId: context.requestId,
      }),
      context.idempotencyKey,
    ],
  );
}
