import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import Stripe from 'stripe';

import { createStripeWebhookRouter } from './stripeWebhookRoutes.js';
import rateLimit from 'express-rate-limit';
import {
  flushErrorReports,
  initErrorReporting,
  installProcessGuards,
  reportError,
} from './observability.js';
import { readWorkerStatus } from './notifications/heartbeat.js';
import { createCustomerApprovalRouter } from './customerApprovalRoutes.js';
import { createPublicWidgetConfigRouter } from './widgetConfigRoutes.js';
import { assertWorkspaceIsCoherent } from './admin/workspaceEnvironment.js';

const { Pool } = pg;

const app = express();
/*
 * Started before anything else can fail.
 *
 * Reporting installed after the first import that throws would miss exactly the
 * faults hardest to diagnose — the ones that happen before the service is
 * listening and leave nothing but an exit code.
 */
initErrorReporting('chime-booking-api');
installProcessGuards('chime-booking-api');

const port = Number(process.env.PORT ?? 8887);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 15000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (err) => console.error('Unexpected idle pg client error', err));
const businessTimeZone = process.env.CHIME_TIME_ZONE?.trim() || undefined;
const publicOrganizationId = process.env.CHIME_PUBLIC_ORGANIZATION_ID?.trim()
  || '00000000-0000-4000-8000-000000000001';
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
// The booking API is where demo_pi_* identifiers are actually accepted in
// place of a verified Stripe payment, so the coherence check matters most here.
assertWorkspaceIsCoherent();
const allowDemoPayments = process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true';

/*
 * How many proxies sit in front of this, and no more.
 *
 * This was `true`, which trusts every hop in X-Forwarded-For — so anyone could
 * prepend an address of their choosing and get a fresh rate-limit bucket on
 * every request, which is the whole limit gone. express-rate-limit refuses to
 * accept the setting for exactly that reason, and said so the first time this
 * ran anywhere other than my own machine.
 *
 * The safe default is to trust nothing: correct when the process is exposed
 * directly, and correct in development. Behind one load balancer set
 * CHIME_TRUST_PROXY_HOPS=1; behind a CDN in front of a balancer, 2. It has to
 * be the real number — one too many is the bypass again.
 */
const trustedProxyHops = Number(process.env.CHIME_TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
  throw new Error('CHIME_TRUST_PROXY_HOPS must be a whole number of proxies, e.g. 1.');
}
app.set('trust proxy', trustedProxyHops === 0 ? false : trustedProxyHops);

/*
 * Mounted before express.json, deliberately.
 *
 * Stripe signs the exact bytes it sent. Once a JSON parser has consumed the
 * stream the original body is gone, and re-serialising the parsed object
 * produces different bytes — different key order, different whitespace — so the
 * signature never verifies. This route parses its own raw body, and can only do
 * that if nothing has read the stream first.
 */
app.use('/api/chime/stripe/webhook', createStripeWebhookRouter(pool, stripe));

app.use(express.json({ limit: '1mb' }));

/*
 * Limits on the two endpoints that cost something to call.
 *
 * Creating a booking writes to the calendar and creating a payment intent
 * spends a Stripe API call, so both are worth a script's while. Reads are not
 * limited: a customer refreshing available times should never be told to slow
 * down, and the widget polls them.
 *
 * Counted per address. Behind a proxy that depends on `trust proxy`, set above,
 * or every request would appear to come from the proxy and one busy customer
 * would lock out everyone.
 */
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  // Generous on purpose. A person booking an appointment, changing their mind
  // and booking again is normal; twenty attempts in ten minutes is not.
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many booking attempts from this connection. Wait a few minutes and try again.',
  },
});
app.use(
  cors({
    origin: process.env.CHIME_CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? true,
    credentials: false,
  }),
);

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function toDateKey(value: Date): string {
  if (!businessTimeZone) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find((part) => part.type === 'year')?.value ?? String(value.getFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(value.getMonth() + 1).padStart(2, '0');
  const day = parts.find((part) => part.type === 'day')?.value ?? String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysDateKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function toTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: businessTimeZone,
  }).format(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${name} is required.`);
  }
  return value.trim();
}

/*
 * Whether this instance can serve bookings.
 *
 * It used to answer `{ ok: true }` unconditionally, which meant an instance
 * that had lost the database still told the load balancer to send it customers.
 * Every booking it received then failed. Health has to depend on the thing the
 * service needs, so it queries.
 *
 * The notification worker is reported here but deliberately does not affect the
 * status code. Reminders being stuck is a real problem, and it is not a reason
 * to stop letting customers book — pulling this instance out of rotation over
 * it would turn a delayed reminder into an outage.
 */
app.get('/api/chime/health', async (_req, res) => {
  const [database, worker] = await Promise.all([
    pool
      .query('SELECT 1')
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({
        ok: false as const,
        reason: error instanceof Error ? error.message : 'Database unreachable.',
      })),
    readWorkerStatus(pool, 'notifications').catch(() => null),
  ]);

  res.status(database.ok ? 200 : 503).json({
    ok: database.ok,
    service: 'chime-booking-api',
    database,
    notificationWorker: worker,
  });
});

app.use('/api/chime/customer-actions', createCustomerApprovalRouter(pool));
app.use('/api/chime/widget-config', createPublicWidgetConfigRouter(pool));

app.get('/api/chime/services', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      select id, name, description, duration_minutes, deposit_amount_cents
      from chime_services
      where active = true
        and (
          organization_id = $1
          or (
            organization_id is null
            and not exists (
              select 1 from chime_services published
               where published.active = true and published.organization_id = $1
            )
          )
        )
      order by sort_order asc, name asc
    `, [publicOrganizationId]);

    res.json({
      services: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        durationMinutes: row.duration_minutes,
        depositAmountCents: row.deposit_amount_cents,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/chime/availability', async (req, res, next) => {
  try {
    const serviceId = requireString(req.query.serviceId, 'serviceId');
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : toDateKey(new Date());
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const params: unknown[] = [serviceId, startDate];
    let endDateClause = '';
    if (endDate) {
      params.push(endDate);
      endDateClause = `and starts_at < ($${params.length}::date + interval '1 day')`;
    }

    const { rows } = await pool.query(
      `
        select id, starts_at, ends_at, status, label, capacity, booked_count
        from chime_availability_slots
        where service_id = $1
          and starts_at >= greatest($2::date, now())
          ${endDateClause}
        order by starts_at asc
      `,
      params,
    );

    const grouped = new Map<string, Array<Record<string, unknown>>>();

    for (const row of rows) {
      const startsAt = new Date(row.starts_at);
      const dateKey = toDateKey(startsAt);
      const available = row.status === 'available' && Number(row.booked_count) < Number(row.capacity);
      const slots = grouped.get(dateKey) ?? [];
      slots.push({
        id: row.id,
        timeLabel: toTimeLabel(startsAt),
        available,
        label: row.label ?? (available ? undefined : 'Booked'),
        startsAt: startsAt.toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
      });
      grouped.set(dateKey, slots);
    }

    res.json({
      availability: Array.from(grouped.entries()).map(([date, slots]) => ({ date, slots })),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/chime/calendar-events', async (req, res, next) => {
  try {
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : toDateKey(new Date());
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : addDaysDateKey(180);

    const { rows } = await pool.query(
      `
        select id, booking_id, title, starts_at, ends_at, event_type
        from chime_calendar_events
        where starts_at >= $1::date
          and starts_at < ($2::date + interval '1 day')
        order by starts_at asc
      `,
      [startDate, endDate],
    );

    res.json({
      events: rows.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        title: row.title,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        date: toDateKey(new Date(row.starts_at)),
        timeLabel: toTimeLabel(new Date(row.starts_at)),
        eventType: row.event_type,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chime/create-payment-intent', writeLimiter, async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured on this server.' });
      return;
    }

    const serviceId = requireString(req.body.serviceId, 'serviceId');
    const slotId = requireString(req.body.slotId, 'slotId');
    const currency = (process.env.CHIME_CURRENCY?.trim() || 'USD').toLowerCase();
    const customerEmail = typeof req.body.customerEmail === 'string' ? req.body.customerEmail : undefined;
    const quoteResult = await pool.query(
      `
        select service.name as service_name,
               service.deposit_amount_cents,
               slot.starts_at,
               slot.status,
               slot.capacity,
               slot.booked_count
        from chime_services service
        join chime_availability_slots slot on slot.service_id = service.id
        where service.id = $1
          and slot.id = $2
          and service.active = true
      `,
      [serviceId, slotId],
    );
    const quote = quoteResult.rows[0];

    if (!quote || quote.status !== 'available' || Number(quote.booked_count) >= Number(quote.capacity)) {
      res.status(409).json({ error: 'That time is no longer available. Please choose another slot.' });
      return;
    }
    const amount = Number(quote.deposit_amount_cents);
    const serviceName = String(quote.service_name);
    if (!Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: 'This service does not require a deposit.' });
      return;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      capture_method: 'manual',
      receipt_email: customerEmail,
      description: `Refundable deposit for ${serviceName}`,
      metadata: {
        serviceId,
        slotId,
        date: toDateKey(new Date(quote.starts_at)),
      },
    });

    if (!paymentIntent.client_secret) {
      res.status(500).json({ error: 'Stripe did not return a client secret for this payment intent.' });
      return;
    }

    // Record a pending hold so the deposit can be tracked even if the booking
    // is never completed. Non-fatal: the payment intent itself is the source
    // of truth and is re-verified before any booking is saved.
    try {
      await pool.query(
        `
          insert into chime_payment_holds (payment_intent_id, amount_cents, currency, status)
          values ($1, $2, $3, 'pending')
          on conflict (payment_intent_id) do nothing
        `,
        [paymentIntent.id, amount, currency.toUpperCase()],
      );
    } catch (holdError) {
      console.error('Failed to record pending payment hold', holdError);
    }

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chime/bookings', writeLimiter, async (req, res, next) => {
  let client: import('pg').PoolClient | null = null;

  try {
    const serviceId = requireString(req.body.serviceId, 'serviceId');
    const slotId = requireString(req.body.slotId, 'slotId');
    const customer = req.body.customer ?? {};
    const name = requireString(customer.name, 'customer.name');
    const email = requireString(customer.email, 'customer.email');
    const phone = typeof customer.phone === 'string' ? customer.phone : null;
    const notes = typeof customer.notes === 'string' ? customer.notes : null;
    const paymentIntentId = typeof req.body.paymentIntentId === 'string' ? req.body.paymentIntentId : null;
    const termsAcceptedAt = typeof req.body.termsAcceptedAt === 'string' ? req.body.termsAcceptedAt : null;

    if (!termsAcceptedAt || Number.isNaN(Date.parse(termsAcceptedAt))) {
      res.status(400).json({ error: 'Terms acceptance is required before confirming an appointment.' });
      return;
    }

    const quoteResult = await pool.query(
      `
        select service.name as service_name,
               service.deposit_amount_cents,
               slot.starts_at,
               slot.ends_at,
               slot.status,
               slot.capacity,
               slot.booked_count
        from chime_services service
        join chime_availability_slots slot on slot.service_id = service.id
        where service.id = $1
          and slot.id = $2
          and service.active = true
      `,
      [serviceId, slotId],
    );
    const quote = quoteResult.rows[0];
    if (!quote || quote.status !== 'available' || Number(quote.booked_count) >= Number(quote.capacity)) {
      res.status(409).json({ error: 'That time is no longer available. Please choose another slot.' });
      return;
    }

    const serviceName = String(quote.service_name);
    const date = toDateKey(new Date(quote.starts_at));
    const timeLabel = toTimeLabel(new Date(quote.starts_at));
    const depositAmountCents = Number(quote.deposit_amount_cents);
    const paymentCurrency = (process.env.CHIME_CURRENCY?.trim() || 'USD').toUpperCase();

    // Verify the deposit payment BEFORE any database write. A booking must not
    // be saved unless the deposit has actually been authorized or captured.
    let holdStatus = 'authorized';
    if (depositAmountCents > 0) {
      if (!paymentIntentId) {
        res.status(402).json({ error: 'A deposit payment is required before this appointment can be booked.' });
        return;
      }

      if (paymentIntentId.startsWith('demo_pi_')) {
        if (!allowDemoPayments) {
          res.status(400).json({ error: 'Demo payments are not accepted by this server.' });
          return;
        }
        holdStatus = 'demo';
      } else if (stripe) {
        let intent: Stripe.PaymentIntent;
        try {
          intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        } catch (stripeError) {
          console.error('Failed to retrieve payment intent for booking', stripeError);
          res.status(402).json({ error: 'The deposit payment has not been completed. Please finish payment and try again.' });
          return;
        }

        const paid =
          (intent.status === 'requires_capture' || intent.status === 'succeeded') &&
          intent.amount === depositAmountCents &&
          intent.currency.toUpperCase() === paymentCurrency &&
          intent.metadata.serviceId === serviceId &&
          intent.metadata.slotId === slotId;
        if (!paid) {
          res.status(402).json({ error: 'The deposit payment has not been completed. Please finish payment and try again.' });
          return;
        }

        holdStatus = intent.status === 'requires_capture' ? 'authorized' : 'captured';
      } else {
        res.status(503).json({ error: 'Payments are not configured on this server.' });
        return;
      }
    }

    client = await pool.connect();
    await client.query('begin');

    const slotResult = await client.query(
      `
        select id, starts_at, ends_at, status, capacity, booked_count
        from chime_availability_slots
        where id = $1 and service_id = $2
        for update
      `,
      [slotId, serviceId],
    );

    const slot = slotResult.rows[0];
    if (!slot || slot.status !== 'available' || Number(slot.booked_count) >= Number(slot.capacity)) {
      await client.query('rollback');
      res.status(409).json({ error: 'That time is no longer available. Please choose another slot.' });
      return;
    }

    const currentServiceResult = await client.query(
      `select deposit_amount_cents from chime_services where id = $1 and active = true for share`,
      [serviceId],
    );
    const currentDepositAmountCents = Number(currentServiceResult.rows[0]?.deposit_amount_cents);
    if (currentDepositAmountCents !== depositAmountCents) {
      await client.query('rollback');
      res.status(409).json({ error: 'The service deposit changed. Please review the updated amount and try again.' });
      return;
    }

    const customerResult = await client.query(
      `
        insert into chime_customers (name, email, phone, notes, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (lower(email)) do update set
          name = excluded.name,
          phone = excluded.phone,
          notes = excluded.notes,
          metadata = excluded.metadata
        returning id
      `,
      [name, email, phone, notes, JSON.stringify(customer)],
    );

    const customerId = customerResult.rows[0].id;

    const bookingResult = await client.query(
      `
        insert into chime_bookings (
          service_id,
          slot_id,
          customer_id,
          appointment_date,
          time_label,
          status,
          deposit_amount_cents,
          payment_intent_id,
          terms_accepted_at
        )
        values ($1, $2, $3, $4::date, $5, 'confirmed', $6, $7, $8::timestamptz)
        returning id
      `,
      [serviceId, slotId, customerId, date, timeLabel, depositAmountCents, paymentIntentId, termsAcceptedAt],
    );

    const bookingId = bookingResult.rows[0].id;

    await client.query(
      `
        update chime_availability_slots
        set booked_count = booked_count + 1,
            status = case when booked_count + 1 >= capacity then 'booked' else status end
        where id = $1
      `,
      [slotId],
    );

    await client.query(
      `
        insert into chime_calendar_events (booking_id, title, starts_at, ends_at, event_type)
        values ($1, $2, $3, $4, 'appointment')
      `,
      [bookingId, `${serviceName} — ${name}`, slot.starts_at, slot.ends_at],
    );

    if (termsAcceptedAt) {
      await client.query(
        `
          insert into chime_terms_acceptances (booking_id, customer_id, terms_version, accepted_at, ip_address, user_agent)
          values ($1, $2, $3, $4::timestamptz, $5, $6)
        `,
        [
          bookingId,
          customerId,
          typeof req.body.termsVersion === 'string' ? req.body.termsVersion : 'default',
          termsAcceptedAt,
          req.ip ?? null,
          req.get('user-agent') ?? null,
        ],
      );
    }

    if (paymentIntentId && depositAmountCents > 0) {
      await client.query(
        `
          insert into chime_payment_holds (booking_id, payment_intent_id, amount_cents, currency, status)
          values ($1, $2, $3, $4, $5)
          on conflict (payment_intent_id) do update set booking_id = excluded.booking_id, status = excluded.status
        `,
        [bookingId, paymentIntentId, depositAmountCents, paymentCurrency, holdStatus],
      );
    }

    await client.query('commit');

    res.json({
      bookingId,
      confirmationMessage: 'Your appointment was saved to the calendar.',
    });
  } catch (error) {
    if (client) {
      await client.query('rollback');
    }
    if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
      const constraint = (error as { constraint?: string }).constraint;
      res.status(409).json({
        error: constraint === 'chime_booking_payment_intent_unique'
          ? 'That payment has already been used for another appointment.'
          : 'That time is no longer available. Please choose another slot.',
      });
      return;
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error('Unhandled request error', error);
  reportError(error, { service: 'chime-booking-api', path: _req.path, method: _req.method });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = app.listen(port, () => {
  console.log(`Chime API listening on http://localhost:${port}`);
});

/*
 * Shut down on a signal rather than being killed.
 *
 * There was no handler here at all, so a redeploy sent SIGTERM, nothing
 * answered, and the container runtime killed the process ten seconds later —
 * cutting off whatever booking was mid-flight and losing any queued error
 * report explaining why the last one failed.
 */
async function shutdown(signal: string) {
  console.log(`${signal} received; closing Chime booking API.`);
  server.close(async () => {
    await flushErrorReports();
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
