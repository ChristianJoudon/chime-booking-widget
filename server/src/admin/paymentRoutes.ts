import { randomUUID } from 'node:crypto';

import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Pool, PoolClient } from 'pg';
import Stripe from 'stripe';

import { getAdminSession, requireRoles } from './auth.js';
import { AdminApiError } from './types.js';
import { parseExpectedVersion, parseUuid, requireIdempotencyKey } from './validation.js';

const PAYMENT_FILTERS = new Set(['all', 'attention', 'authorized', 'collected', 'refunded', 'cancelled']);
const PAYMENT_ACTIONS = new Set(['capture', 'void', 'refund', 'sync']);

type PaymentActionName = 'capture' | 'void' | 'refund' | 'sync';
type PaymentStatus =
  | 'requires_payment'
  | 'processing'
  | 'authorized'
  | 'succeeded'
  | 'failed'
  | 'partially_refunded'
  | 'refunded'
  | 'cancelled';

type PaymentRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  provider: string;
  provider_payment_id: string;
  amount_minor: number | string;
  captured_amount_minor: number | string;
  refunded_amount_minor: number | string;
  currency: string;
  status: PaymentStatus;
  version: number | string;
};

type ProviderResult = {
  status: PaymentStatus;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  providerOperationId: string;
};

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function text(value: unknown, maximum = 500): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, maximum);
}

function paymentRuntime() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const demo = process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true';
  if (secret) {
    const live = secret.startsWith('sk_live_');
    return {
      provider: 'stripe' as const,
      mode: live ? 'live' as const : 'test' as const,
      configured: true,
      actionsEnabled: true,
      message: live
        ? 'Stripe is connected for live customer deposits.'
        : 'Stripe test mode is connected. No live cards will be charged.',
    };
  }
  if (demo) {
    return {
      provider: 'demo' as const,
      mode: 'demo' as const,
      configured: true,
      actionsEnabled: true,
      message: 'Demo payments are enabled for this local Chime workspace.',
    };
  }
  return {
    provider: 'none' as const,
    mode: 'unconfigured' as const,
    configured: false,
    actionsEnabled: false,
    message: 'Connect Stripe before collecting or returning customer deposits.',
  };
}

function stripeClient(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  return secret ? new Stripe(secret) : null;
}

function mapAction(row: Record<string, unknown>) {
  return {
    id: row.id,
    action: row.action,
    amountMinor: numberValue(row.amount_minor),
    status: row.status,
    reason: row.reason,
    errorMessage: row.error_message,
    providerOperationId: row.provider_operation_id,
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at),
  };
}

function mapPayment(row: Record<string, unknown>) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    referenceCode: row.reference_code,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    serviceName: row.service_name,
    startsAt: iso(row.starts_at),
    appointmentStatus: row.appointment_status,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amountMinor: numberValue(row.amount_minor),
    capturedAmountMinor: numberValue(row.captured_amount_minor),
    refundedAmountMinor: numberValue(row.refunded_amount_minor),
    currency: row.currency,
    status: row.status,
    failureMessage: row.failure_message,
    paymentMethodSummary: row.payment_method_summary ?? {},
    verifiedAt: iso(row.verified_at),
    lastProviderSyncAt: iso(row.last_provider_sync_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: numberValue(row.version),
    actions: Array.isArray(row.actions)
      ? row.actions.map((action) => mapAction(action as Record<string, unknown>))
      : [],
  };
}

const PAYMENT_SELECT = `
  SELECT
    payment.*,
    appointment.reference_code,
    appointment.starts_at,
    appointment.status AS appointment_status,
    customer.display_name AS customer_name,
    customer.email AS customer_email,
    service.name AS service_name,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(history) ORDER BY history.created_at DESC)
      FROM (
        SELECT action.id, action.action, action.amount_minor, action.status,
          action.reason, action.error_message, action.provider_operation_id,
          action.created_at, action.completed_at
        FROM chime_app.payment_actions action
        WHERE action.organization_id = payment.organization_id
          AND action.payment_id = payment.id
        ORDER BY action.created_at DESC
        LIMIT 12
      ) history
    ), '[]'::jsonb) AS actions
  FROM chime_app.payments payment
  JOIN chime_app.appointments appointment
    ON appointment.organization_id = payment.organization_id
   AND appointment.id = payment.appointment_id
  JOIN chime_app.customers customer
    ON customer.organization_id = appointment.organization_id
   AND customer.id = appointment.customer_id
  JOIN chime_app.services service
    ON service.organization_id = appointment.organization_id
   AND service.id = appointment.service_id
`;

async function readPayment(pool: Pool | PoolClient, organizationId: string, paymentId: string) {
  const result = await pool.query(
    `${PAYMENT_SELECT} WHERE payment.organization_id = $1 AND payment.id = $2`,
    [organizationId, paymentId],
  );
  const payment = result.rows[0];
  if (!payment) throw new AdminApiError(404, 'PAYMENT_NOT_FOUND', 'That customer payment was not found.');
  return payment;
}

function validateAction(payment: PaymentRow, action: PaymentActionName, amountMinor: number): void {
  const amount = numberValue(payment.amount_minor);
  const captured = numberValue(payment.captured_amount_minor);
  const refunded = numberValue(payment.refunded_amount_minor);
  if (action === 'capture' && payment.status !== 'authorized') {
    throw new AdminApiError(409, 'PAYMENT_NOT_AUTHORIZED', 'Only an authorized deposit can be collected.');
  }
  if (action === 'void' && !['authorized', 'processing', 'requires_payment'].includes(payment.status)) {
    throw new AdminApiError(409, 'PAYMENT_CANNOT_BE_VOIDED', 'This deposit can no longer be voided.');
  }
  if (action === 'refund') {
    const available = captured - refunded;
    if (!['succeeded', 'partially_refunded'].includes(payment.status) || available <= 0) {
      throw new AdminApiError(409, 'PAYMENT_CANNOT_BE_REFUNDED', 'This deposit has no refundable balance.');
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > available) {
      throw new AdminApiError(400, 'INVALID_REFUND_AMOUNT', 'Enter a refund no larger than the collected balance.');
    }
  }
  if (action === 'capture' && amountMinor > 0 && amountMinor > amount - captured) {
    throw new AdminApiError(400, 'INVALID_CAPTURE_AMOUNT', 'The collection amount exceeds the authorization.');
  }
}

function statusFromIntent(intent: Stripe.PaymentIntent): PaymentStatus {
  if (intent.status === 'succeeded') return 'succeeded';
  if (intent.status === 'requires_capture') return 'authorized';
  if (intent.status === 'processing') return 'processing';
  if (intent.status === 'canceled') return 'cancelled';
  if (intent.status === 'requires_payment_method') return 'failed';
  return 'requires_payment';
}

async function runProviderAction(
  payment: PaymentRow,
  action: PaymentActionName,
  amountMinor: number,
  idempotencyKey: string,
): Promise<ProviderResult> {
  const amount = numberValue(payment.amount_minor);
  const captured = numberValue(payment.captured_amount_minor);
  const refunded = numberValue(payment.refunded_amount_minor);
  const demo = payment.provider === 'demo' || payment.provider_payment_id.startsWith('demo_pi_');

  if (demo) {
    if (process.env.CHIME_ALLOW_DEMO_PAYMENTS !== 'true') {
      throw new AdminApiError(503, 'DEMO_PAYMENTS_DISABLED', 'Demo payment actions are disabled.');
    }
    if (action === 'capture') {
      return { status: 'succeeded', capturedAmountMinor: amount, refundedAmountMinor: refunded, providerOperationId: `demo_capture_${randomUUID()}` };
    }
    if (action === 'void') {
      return { status: 'cancelled', capturedAmountMinor: captured, refundedAmountMinor: refunded, providerOperationId: `demo_void_${randomUUID()}` };
    }
    if (action === 'refund') {
      const nextRefunded = refunded + amountMinor;
      return {
        status: nextRefunded >= captured ? 'refunded' : 'partially_refunded',
        capturedAmountMinor: captured,
        refundedAmountMinor: nextRefunded,
        providerOperationId: `demo_refund_${randomUUID()}`,
      };
    }
    return { status: payment.status, capturedAmountMinor: captured, refundedAmountMinor: refunded, providerOperationId: `demo_sync_${randomUUID()}` };
  }

  const stripe = stripeClient();
  if (!stripe) {
    throw new AdminApiError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Stripe is not connected for this Chime workspace.');
  }

  if (action === 'capture') {
    const intent = await stripe.paymentIntents.capture(
      payment.provider_payment_id,
      amountMinor > 0 ? { amount_to_capture: amountMinor } : {},
      { idempotencyKey },
    );
    return {
      status: statusFromIntent(intent),
      capturedAmountMinor: intent.amount_received || amountMinor || amount,
      refundedAmountMinor: refunded,
      providerOperationId: intent.id,
    };
  }
  if (action === 'void') {
    const intent = await stripe.paymentIntents.cancel(
      payment.provider_payment_id,
      { cancellation_reason: 'abandoned' },
      { idempotencyKey },
    );
    return {
      status: statusFromIntent(intent),
      capturedAmountMinor: intent.amount_received || captured,
      refundedAmountMinor: refunded,
      providerOperationId: intent.id,
    };
  }
  if (action === 'refund') {
    const refund = await stripe.refunds.create(
      { payment_intent: payment.provider_payment_id, amount: amountMinor, reason: 'requested_by_customer' },
      { idempotencyKey },
    );
    if (refund.status === 'failed') {
      throw new AdminApiError(502, 'REFUND_FAILED', refund.failure_reason ?? 'Stripe could not complete this refund.');
    }
    const nextRefunded = refunded + amountMinor;
    return {
      status: nextRefunded >= captured ? 'refunded' : 'partially_refunded',
      capturedAmountMinor: captured,
      refundedAmountMinor: nextRefunded,
      providerOperationId: refund.id,
    };
  }

  const intent = await stripe.paymentIntents.retrieve(payment.provider_payment_id);
  return {
    status: statusFromIntent(intent),
    capturedAmountMinor: intent.amount_received || captured,
    refundedAmountMinor: refunded,
    providerOperationId: intent.id,
  };
}

async function completeAction(
  pool: Pool,
  request: Request,
  payment: PaymentRow,
  actionId: string,
  action: PaymentActionName,
  result: ProviderResult,
) {
  const session = getAdminSession(request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE chime_app.payments
       SET status = $3,
           captured_amount_minor = $4,
           refunded_amount_minor = $5,
           failure_message = NULL,
           last_provider_sync_at = now(),
           verified_at = CASE WHEN $3 IN ('authorized', 'succeeded', 'partially_refunded', 'refunded')
             THEN COALESCE(verified_at, now()) ELSE verified_at END,
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [session.organizationId, payment.id, result.status, result.capturedAmountMinor, result.refundedAmountMinor],
    );
    await client.query(
      `UPDATE chime_app.payment_actions
       SET status = 'succeeded', provider_operation_id = $3, completed_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [session.organizationId, actionId, result.providerOperationId],
    );
    const legacyStatus = result.status === 'succeeded'
      ? 'captured'
      : result.status === 'cancelled'
        ? 'cancelled'
        : result.status === 'refunded'
          ? 'refunded'
          : result.status;
    await client.query(
      `UPDATE public.chime_payment_holds
       SET status = $2, updated_at = now()
       WHERE payment_intent_id = $1`,
      [payment.provider_payment_id, legacyStatus],
    );
    await client.query(
      `INSERT INTO chime_app.audit_events (
         organization_id, actor_kind, actor_id, action,
         entity_type, entity_id, after_state, correlation_id
       ) VALUES ($1, 'user', $2, $3, 'payment', $4, $5, $6)`,
      [
        session.organizationId,
        session.subject,
        `payment.${action}_completed`,
        payment.id,
        JSON.stringify({ status: result.status, providerOperationId: result.providerOperationId }),
        request.chimeRequestId ?? randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO chime_app.outbox_events (
         organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
       ) VALUES ($1, $2, 'payment', $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        session.organizationId,
        `payment.${action}_completed`,
        payment.id,
        JSON.stringify({ paymentId: payment.id, status: result.status }),
        `payment-action:${actionId}`,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createPaymentRouter(pool: Pool): Router {
  const router = Router();

  router.get('/payments', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const filter = typeof request.query.status === 'string' ? request.query.status : 'all';
    if (!PAYMENT_FILTERS.has(filter)) {
      throw new AdminApiError(400, 'INVALID_PAYMENT_FILTER', 'Unknown payment status filter.');
    }
    const clauses: Record<string, string> = {
      all: '',
      attention: "AND payment.status IN ('requires_payment', 'processing', 'failed')",
      authorized: "AND payment.status = 'authorized'",
      collected: "AND payment.status IN ('succeeded', 'partially_refunded')",
      refunded: "AND payment.status IN ('refunded', 'partially_refunded')",
      cancelled: "AND payment.status = 'cancelled'",
    };
    const [summaryResult, paymentsResult] = await Promise.all([
      pool.query(
        `SELECT
           count(*)::int AS total,
           COALESCE(max(currency), 'USD') AS currency,
           count(*) FILTER (WHERE status IN ('succeeded', 'partially_refunded'))::int AS collected_count,
           COALESCE(sum(captured_amount_minor - refunded_amount_minor)
             FILTER (WHERE status IN ('succeeded', 'partially_refunded')), 0)::int AS collected_minor,
           count(*) FILTER (WHERE status = 'authorized')::int AS authorized_count,
           COALESCE(sum(amount_minor) FILTER (WHERE status = 'authorized'), 0)::int AS authorized_minor,
           count(*) FILTER (WHERE status IN ('requires_payment', 'processing'))::int AS pending_count,
           COALESCE(sum(amount_minor) FILTER (WHERE status IN ('requires_payment', 'processing')), 0)::int AS pending_minor,
           count(*) FILTER (WHERE status IN ('refunded', 'partially_refunded'))::int AS refunded_count,
           COALESCE(sum(refunded_amount_minor), 0)::int AS refunded_minor,
           count(*) FILTER (WHERE status = 'failed')::int AS failed_count
         FROM chime_app.payments
         WHERE organization_id = $1`,
        [session.organizationId],
      ),
      pool.query(
        `${PAYMENT_SELECT}
         WHERE payment.organization_id = $1 ${clauses[filter]}
         ORDER BY
           CASE payment.status
             WHEN 'failed' THEN 0
             WHEN 'authorized' THEN 1
             WHEN 'processing' THEN 2
             ELSE 3
           END,
           payment.updated_at DESC
         LIMIT 100`,
        [session.organizationId],
      ),
    ]);
    const summary = summaryResult.rows[0];
    response.json({
      runtime: paymentRuntime(),
      summary: {
        currency: summary.currency,
        total: numberValue(summary.total),
        collectedCount: numberValue(summary.collected_count),
        collectedMinor: numberValue(summary.collected_minor),
        authorizedCount: numberValue(summary.authorized_count),
        authorizedMinor: numberValue(summary.authorized_minor),
        pendingCount: numberValue(summary.pending_count),
        pendingMinor: numberValue(summary.pending_minor),
        refundedCount: numberValue(summary.refunded_count),
        refundedMinor: numberValue(summary.refunded_minor),
        failedCount: numberValue(summary.failed_count),
      },
      payments: paymentsResult.rows.map(mapPayment),
    });
  }));

  router.post(
    '/payments/:paymentId/actions',
    requireRoles('owner', 'admin', 'manager'),
    asyncRoute(async (request, response) => {
      const session = getAdminSession(request);
      const paymentId = parseUuid(request.params.paymentId, 'paymentId');
      const expectedVersion = parseExpectedVersion(request.get('if-match'));
      const idempotencyKey = requireIdempotencyKey(request.get('idempotency-key'));
      const action = String(request.body?.action ?? '') as PaymentActionName;
      if (!PAYMENT_ACTIONS.has(action)) {
        throw new AdminApiError(400, 'INVALID_PAYMENT_ACTION', 'Choose collect, void, refund, or sync.');
      }
      const requestedAmount = Number(request.body?.amountMinor ?? 0);
      const reason = text(request.body?.reason, 500);
      const client = await pool.connect();
      let payment: PaymentRow;
      let actionRow: Record<string, unknown>;
      try {
        await client.query('BEGIN');
        const replay = await client.query(
          `SELECT * FROM chime_app.payment_actions
           WHERE organization_id = $1 AND idempotency_key = $2`,
          [session.organizationId, idempotencyKey],
        );
        if (replay.rows[0]) {
          await client.query('COMMIT');
          const current = await readPayment(pool, session.organizationId, paymentId);
          response.json({ payment: mapPayment(current), action: mapAction(replay.rows[0]), replayed: true });
          return;
        }
        const paymentResult = await client.query<PaymentRow>(
          `SELECT * FROM chime_app.payments
           WHERE organization_id = $1 AND id = $2
           FOR UPDATE`,
          [session.organizationId, paymentId],
        );
        payment = paymentResult.rows[0];
        if (!payment) throw new AdminApiError(404, 'PAYMENT_NOT_FOUND', 'That customer payment was not found.');
        if (numberValue(payment.version) !== expectedVersion) {
          throw new AdminApiError(409, 'PAYMENT_VERSION_CONFLICT', 'This payment changed in another session. Refresh before acting again.');
        }
        const amountMinor = action === 'refund'
          ? requestedAmount
          : action === 'capture' && requestedAmount > 0
            ? requestedAmount
            : 0;
        validateAction(payment, action, amountMinor);
        const inserted = await client.query(
          `INSERT INTO chime_app.payment_actions (
             organization_id, payment_id, initiated_by_user_id,
             action, amount_minor, reason, idempotency_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [session.organizationId, paymentId, session.subject, action, amountMinor, reason, idempotencyKey],
        );
        actionRow = inserted.rows[0];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      try {
        const amountMinor = numberValue(actionRow.amount_minor);
        const result = await runProviderAction(payment, action, amountMinor, idempotencyKey);
        await completeAction(pool, request, payment, String(actionRow.id), action, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The payment provider could not complete this action.';
        await pool.query(
          `UPDATE chime_app.payment_actions
           SET status = 'failed', error_message = $3, completed_at = now()
           WHERE organization_id = $1 AND id = $2`,
          [session.organizationId, actionRow.id, message.slice(0, 1000)],
        );
        await pool.query(
          `UPDATE chime_app.payments
           SET failure_message = $3, version = version + 1, updated_at = now()
           WHERE organization_id = $1 AND id = $2`,
          [session.organizationId, payment.id, message.slice(0, 1000)],
        );
        if (error instanceof AdminApiError) throw error;
        throw new AdminApiError(502, 'PAYMENT_PROVIDER_ERROR', message);
      }

      const current = await readPayment(pool, session.organizationId, paymentId);
      const completedAction = current.actions?.find((candidate: Record<string, unknown>) => candidate.id === actionRow.id)
        ?? actionRow;
      response.json({ payment: mapPayment(current), action: mapAction(completedAction) });
    }),
  );

  return router;
}
