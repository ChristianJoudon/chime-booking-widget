import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { Pool } from 'pg';
import Stripe from 'stripe';

/**
 * Receives Stripe's account of what happened, which is the only account that
 * is authoritative about money.
 *
 * Everything else in this server learns about a payment from the customer's
 * browser telling it so. That works until the browser does not finish: the card
 * is charged at Stripe and the booking request never arrives, leaving money
 * taken and no appointment. Nobody notices until somebody turns up.
 *
 * Two things happen here:
 *
 *   - a payment whose booking exists is reconciled to Stripe's status, so the
 *     ledger matches the provider without anyone pressing Sync
 *   - a payment whose booking does *not* exist flags its hold, so the money
 *     with nothing behind it is visible instead of silent
 *
 * Deliberately not done here: creating the missing booking. Stripe knows the
 * amount and the card, not which slot the customer wanted or what they typed
 * into the form. Inventing an appointment from a payment would put someone in
 * the calendar at a time nobody chose.
 */

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

/** Stripe's status vocabulary, mapped to the ledger's. */
function statusFromIntent(intent: Stripe.PaymentIntent): string {
  if (intent.status === 'succeeded') return 'succeeded';
  if (intent.status === 'requires_capture') return 'authorized';
  if (intent.status === 'processing') return 'processing';
  if (intent.status === 'canceled') return 'cancelled';
  if (intent.status === 'requires_payment_method') return 'failed';
  return 'requires_payment';
}

/** The events worth acting on. Everything else is acknowledged and ignored. */
const HANDLED = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
]);

export function createStripeWebhookRouter(pool: Pool, stripe: Stripe | null) {
  const router = Router();

  /*
   * The raw body, not the parsed one. Stripe signs the exact bytes it sent, so
   * a re-serialised object will not verify — key order and whitespace differ.
   * This route therefore parses raw and must be mounted before any JSON body
   * parser that would consume the stream first.
   */
  router.post(
    '/',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (request: Request, response: Response) => {
      if (!stripe || !WEBHOOK_SECRET) {
        // Returning 503 rather than 200 so Stripe keeps the event and retries
        // once this is configured, instead of considering it delivered.
        response.status(503).json({
          error: 'Stripe webhooks are not configured on this server.',
        });
        return;
      }

      const signature = request.header('stripe-signature');
      if (!signature) {
        response.status(400).json({ error: 'Missing stripe-signature header.' });
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          signature,
          WEBHOOK_SECRET,
        );
      } catch (error) {
        // An unverifiable body is either a misconfigured secret or someone
        // else posting. Neither should be acted on, and neither should be
        // retried, so this is a 400 rather than a 5xx.
        response.status(400).json({
          error: `Signature verification failed: ${(error as Error).message}`,
        });
        return;
      }

      const intent = event.data.object as Stripe.PaymentIntent;
      const intentId = typeof intent?.id === 'string' && intent.id.startsWith('pi_')
        ? intent.id
        : null;

      // Claim the event id. A retry of something already handled conflicts
      // here and returns without doing the work twice.
      const claim = await pool.query(
        `INSERT INTO chime_app.stripe_webhook_events (id, type, payment_intent_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [event.id, event.type, intentId],
      );
      if (claim.rowCount === 0) {
        response.json({ received: true, duplicate: true });
        return;
      }

      let outcome = 'ignored';
      let detail: string | null = null;

      try {
        if (HANDLED.has(event.type) && intentId) {
          const result = await reconcile(pool, intentId, statusFromIntent(intent));
          outcome = result.outcome;
          detail = result.detail;
        }
      } catch (error) {
        outcome = 'failed';
        detail = (error as Error).message.slice(0, 400);
        await pool.query(
          `UPDATE chime_app.stripe_webhook_events
             SET handled_at = now(), outcome = $2, detail = $3
           WHERE id = $1`,
          [event.id, outcome, detail],
        );
        // A 500 asks Stripe to retry, which is what should happen when the
        // failure is ours rather than the event's.
        response.status(500).json({ error: 'Could not process the event.' });
        return;
      }

      await pool.query(
        `UPDATE chime_app.stripe_webhook_events
           SET handled_at = now(), outcome = $2, detail = $3
         WHERE id = $1`,
        [event.id, outcome, detail],
      );

      response.json({ received: true, outcome });
    },
  );

  return router;
}

/**
 * Brings the ledger into line with Stripe for one payment intent, or flags the
 * hold when there is money and no booking behind it.
 */
async function reconcile(
  pool: Pool,
  intentId: string,
  status: string,
): Promise<{ outcome: string; detail: string | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: payments } = await client.query(
      `SELECT id, status FROM chime_app.payments
        WHERE provider_payment_id = $1
        FOR UPDATE`,
      [intentId],
    );

    if (payments.length > 0) {
      const before = payments[0].status;
      if (before === status) {
        await client.query('COMMIT');
        return { outcome: 'already-matched', detail: `already ${status}` };
      }
      await client.query(
        `UPDATE chime_app.payments
            SET status = $2,
                -- A collected payment must carry proof it was verified with
                -- the provider; this event is that proof.
                verified_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE verified_at END,
                updated_at = now()
          WHERE provider_payment_id = $1`,
        [intentId, status],
      );
      await client.query('COMMIT');
      return { outcome: 'reconciled', detail: `${before} -> ${status}` };
    }

    // No payment row means no booking was ever written for this intent.
    if (status === 'succeeded' || status === 'authorized') {
      const { rowCount } = await client.query(
        `UPDATE public.chime_payment_holds
            SET needs_attention_reason = $2,
                flagged_at = now(),
                updated_at = now()
          WHERE payment_intent_id = $1
            AND booking_id IS NULL`,
        [
          intentId,
          `Stripe reports this payment as ${status}, but no appointment was ever `
          + 'created for it. The customer was charged and has no booking.',
        ],
      );
      await client.query('COMMIT');
      return rowCount
        ? { outcome: 'flagged-orphan', detail: 'money taken with no appointment' }
        : { outcome: 'unknown-intent', detail: 'no hold and no payment for this intent' };
    }

    await client.query('COMMIT');
    return { outcome: 'ignored', detail: `no payment row; status ${status}` };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
