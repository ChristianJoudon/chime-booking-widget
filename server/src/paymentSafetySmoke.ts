import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const apiBaseUrl = (process.env.CHIME_BOOKING_API_BASE_URL ?? 'http://127.0.0.1:8787/api/chime').replace(/\/$/, '');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const nonce = Date.now();
const email = `maya.kealoha.${nonce}@example.invalid`;
let createdBookingId: string | null = null;

interface QuoteRow {
  service_id: string;
  service_name: string;
  deposit_amount_cents: number;
  slot_id: string;
  starts_at: Date;
  time_label: string;
  booked_count: number;
}

async function postBooking(payload: Record<string, unknown>) {
  const response = await fetch(`${apiBaseUrl}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { body, status: response.status };
}

async function bookingCount(): Promise<number> {
  const result = await pool.query(
    `select count(*)::int as count
       from chime_bookings booking
       join chime_customers customer on customer.id = booking.customer_id
      where lower(customer.email) = lower($1)`,
    [email],
  );
  return Number(result.rows[0].count);
}

async function cleanupBooking(bookingId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const bookingResult = await client.query(
      `select slot_id, customer_id from chime_bookings where id = $1 for update`,
      [bookingId],
    );
    const booking = bookingResult.rows[0];
    if (!booking) {
      await client.query('rollback');
      return;
    }
    await client.query(`delete from chime_terms_acceptances where booking_id = $1`, [bookingId]);
    await client.query(`delete from chime_calendar_events where booking_id = $1`, [bookingId]);
    await client.query(`delete from chime_payment_holds where booking_id = $1`, [bookingId]);
    await client.query(`delete from chime_bookings where id = $1`, [bookingId]);
    await client.query(
      `update chime_availability_slots
          set booked_count = greatest(booked_count - 1, 0),
              status = case when greatest(booked_count - 1, 0) < capacity then 'available' else status end
        where id = $1`,
      [booking.slot_id],
    );
    await client.query(
      `delete from chime_customers customer
        where customer.id = $1
          and not exists (select 1 from chime_bookings booking where booking.customer_id = customer.id)`,
      [booking.customer_id],
    );
    await client.query(
      `delete from chime_app.appointments appointment
        using chime_app.customers customer
        where appointment.customer_id = customer.id
          and appointment.organization_id = customer.organization_id
          and lower(customer.email) = lower($1)`,
      [email],
    );
    await client.query(
      `delete from chime_app.customers customer
        where lower(customer.email) = lower($1)
          and not exists (
            select 1
              from chime_app.appointments appointment
             where appointment.customer_id = customer.id
          )`,
      [email],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

try {
  const quoteResult = await pool.query<QuoteRow>(
    `select service.id as service_id,
            service.name as service_name,
            service.deposit_amount_cents,
            slot.id as slot_id,
            slot.starts_at,
            to_char(slot.starts_at, 'HH24:MI') as time_label,
            slot.booked_count
       from chime_services service
       join chime_availability_slots slot on slot.service_id = service.id
      where service.active = true
        and service.deposit_amount_cents > 0
        and slot.status = 'available'
        and slot.booked_count < slot.capacity
        and slot.starts_at > now()
      order by slot.starts_at
      limit 2`,
  );
  assert.equal(quoteResult.rows.length, 2, 'Two paid available slots are required for payment safety testing.');
  const [quote, replayQuote] = quoteResult.rows;
  const initialBookings = await bookingCount();
  const basePayload = {
    serviceId: quote.service_id,
    slotId: quote.slot_id,
    serviceName: 'Tampered browser service',
    date: '2000-01-01',
    timeLabel: 'Not a real time',
    depositAmountCents: 0,
    customer: { name: 'Maya Kealoha', email },
    termsAcceptedAt: new Date().toISOString(),
  };

  const missing = await postBooking(basePayload);
  assert.equal(missing.status, 402, JSON.stringify(missing.body));
  assert.equal(await bookingCount(), initialBookings, 'Missing payment must not write a booking.');

  const fake = await postBooking({ ...basePayload, paymentIntentId: `pi_fake_${nonce}` });
  assert.equal(fake.status, 503, JSON.stringify(fake.body));
  assert.equal(await bookingCount(), initialBookings, 'Fake payment must not write a booking.');

  const demoPaymentIntentId = `demo_pi_payment_safety_${nonce}`;
  const paid = await postBooking({ ...basePayload, paymentIntentId: demoPaymentIntentId });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  createdBookingId = String(paid.body?.bookingId ?? '');
  assert.match(createdBookingId, /^[0-9a-f-]{36}$/i);

  const storedResult = await pool.query(
    `select booking.service_id,
            booking.appointment_date::text,
            booking.time_label,
            booking.deposit_amount_cents,
            booking.payment_intent_id,
            booking.status,
            hold.amount_cents as hold_amount_cents,
            hold.status as hold_status,
            (select count(*)::int from chime_terms_acceptances terms where terms.booking_id = booking.id) as terms_count,
            (select count(*)::int from chime_calendar_events event where event.booking_id = booking.id) as event_count
       from chime_bookings booking
       left join chime_payment_holds hold on hold.booking_id = booking.id
      where booking.id = $1`,
    [createdBookingId],
  );
  const stored = storedResult.rows[0];
  assert(stored, 'Successful demo payment must create a booking.');
  assert.equal(stored.service_id, quote.service_id);
  assert.equal(Number(stored.deposit_amount_cents), Number(quote.deposit_amount_cents));
  assert.equal(stored.payment_intent_id, demoPaymentIntentId);
  assert.equal(stored.status, 'confirmed');
  assert.equal(Number(stored.hold_amount_cents), Number(quote.deposit_amount_cents));
  assert.equal(stored.hold_status, 'demo');
  assert.equal(Number(stored.terms_count), 1);
  assert.equal(Number(stored.event_count), 1);
  assert.notEqual(stored.appointment_date, '2000-01-01');
  assert.notEqual(stored.time_label, 'Not a real time');

  const replay = await postBooking({
    ...basePayload,
    slotId: replayQuote.slot_id,
    paymentIntentId: demoPaymentIntentId,
  });
  assert.equal(replay.status, 409, JSON.stringify(replay.body));
  const replayRows = await pool.query(
    `select count(*)::int as count from chime_bookings where slot_id = $1`,
    [replayQuote.slot_id],
  );
  assert.equal(Number(replayRows.rows[0].count), 0, 'A payment intent cannot be reused on another slot.');

  console.log(JSON.stringify({
    checks: [
      'database-authoritative deposit',
      'missing payment rejected without writes',
      'fake payment rejected without writes',
      'demo payment accepted',
      'canonical date and time stored',
      'terms, calendar, and payment hold persisted',
      'payment intent replay rejected',
    ],
    depositAmountCents: Number(quote.deposit_amount_cents),
    serviceId: quote.service_id,
  }, null, 2));
} finally {
  if (createdBookingId) {
    await cleanupBooking(createdBookingId);
  }
  await pool.end();
}
