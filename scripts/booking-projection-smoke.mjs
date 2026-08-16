#!/usr/bin/env node
/**
 * End-to-end check for the widget -> admin projection.
 *
 * Proves the path that migration 005 installs:
 *
 *   customer booking API
 *     -> public.chime_bookings
 *     -> AFTER INSERT trigger chime_app.project_widget_booking()
 *     -> chime_app.appointments + customers + payments + appointment_staff
 *     -> chime_app.outbox_events
 *
 * It also asserts the payment guardrail from the product plan: a deposit-bearing
 * service must reject an unpaid booking with 402 and write no rows.
 *
 * Everything it creates is removed at the end. Deleting the widget booking fires
 * the BEFORE DELETE removal trigger, which unwinds the projection, so the
 * teardown doubles as a check that removal works in both directions.
 *
 * Usage:
 *   npm run test:booking-projection
 *
 * Requires the customer booking API on :8887 with CHIME_ALLOW_DEMO_PAYMENTS=true
 * (see server/.env) and a database seeded from docker-compose.
 */

import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const API = (process.env.CHIME_BOOKING_API_BASE_URL ?? 'http://127.0.0.1:8887/api/chime').replace(/\/+$/, '');
const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';
const EMAIL = 'booking-projection-smoke@example.invalid';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function cleanup(pool, bookingId, slotId) {
  if (bookingId) {
    // Fires aa_chime_remove_widget_booking_projection, unwinding the projection.
    await pool.query('DELETE FROM public.chime_bookings WHERE id = $1', [bookingId]);
    await pool.query('DELETE FROM chime_app.outbox_events WHERE aggregate_id = $1', [bookingId]);
  }
  await pool.query('DELETE FROM chime_app.notification_deliveries WHERE recipient = $1', [EMAIL]);
  await pool.query(
    `DELETE FROM chime_app.widget_customer_links
      WHERE customer_id IN (SELECT id FROM chime_app.customers WHERE email = $1)`,
    [EMAIL],
  );
  await pool.query('DELETE FROM chime_app.customers WHERE email = $1', [EMAIL]);
  await pool.query('DELETE FROM public.chime_customers WHERE email = $1', [EMAIL]);
  if (slotId) {
    await pool.query(
      `UPDATE public.chime_availability_slots
          SET booked_count = 0, status = 'available'
        WHERE id = $1`,
      [slotId],
    );
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  let bookingId = null;
  let slotId = null;

  try {
    const health = await fetch(`${API}/health`).catch(() => null);
    if (!health?.ok) {
      console.error(`Cannot reach the booking API at ${API}. Start it with: cd server && npm run dev`);
      process.exitCode = 2;
      return;
    }

    // Pick a deposit-bearing service so the payment guardrail is exercised.
    const { services } = await (await fetch(`${API}/services`)).json();
    const service = services.find((entry) => Number(entry.depositAmountCents) > 0);
    if (!service) {
      console.error('No deposit-bearing service found; cannot verify the payment guardrail.');
      process.exitCode = 2;
      return;
    }

    const { availability } = await (await fetch(`${API}/availability?serviceId=${service.id}`)).json();
    const slot = (availability ?? []).flatMap((day) => day.slots ?? []).find((entry) => entry.available);
    if (!slot) {
      console.error('No available slot found for that service.');
      process.exitCode = 2;
      return;
    }
    slotId = slot.id;
    console.log(`service: ${service.name} (deposit ${service.depositAmountCents}c)`);
    console.log(`slot:    ${slot.label} (${slot.startsAt})\n`);

    const booking = {
      serviceId: service.id,
      slotId: slot.id,
      customer: { name: 'Booking Projection Smoke', email: EMAIL, phone: '+18085550123' },
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: 'booking-projection-smoke',
    };

    // 1. Unpaid booking must be refused, and must leave nothing behind.
    const unpaid = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...booking, paymentIntentId: null }),
    });
    check('unpaid booking rejected with 402', unpaid.status === 402, `got ${unpaid.status}`);

    const orphans = await pool.query(
      'SELECT count(*)::int AS total FROM public.chime_customers WHERE email = $1',
      [EMAIL],
    );
    check('unpaid booking wrote no rows', orphans.rows[0].total === 0, `found ${orphans.rows[0].total}`);

    // 2. Verified booking must be accepted and projected.
    const paid = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...booking, paymentIntentId: `demo_pi_smoke_${Date.now()}` }),
    });
    const created = await paid.json();
    check('verified booking accepted', paid.ok, `got ${paid.status}`);
    if (!paid.ok) return;
    bookingId = created.bookingId;

    const projected = await pool.query(
      `SELECT a.reference_code, a.status, a.source,
              c.display_name AS customer_name,
              p.status       AS payment_status,
              p.amount_minor,
              (SELECT count(*)::int FROM chime_app.appointment_staff s
                WHERE s.appointment_id = a.id) AS staff_count,
              (SELECT count(*)::int FROM chime_app.outbox_events o
                WHERE o.aggregate_id = a.id)   AS outbox_count
         FROM chime_app.widget_booking_links link
         JOIN chime_app.appointments a ON a.id = link.appointment_id
         JOIN chime_app.customers   c ON c.id = a.customer_id
         LEFT JOIN chime_app.payments p ON p.appointment_id = a.id
        WHERE link.widget_booking_id = $1`,
      [bookingId],
    );

    const row = projected.rows[0];
    check('projected into chime_app.appointments', Boolean(row), row ? row.reference_code : 'no row');
    if (row) {
      check('appointment source is widget', row.source === 'widget', row.source);
      check('admin customer created', row.customer_name === 'Booking Projection Smoke', row.customer_name);
      check('payment recorded', row.payment_status === 'succeeded', String(row.payment_status));
      check('deposit amount matches', Number(row.amount_minor) === Number(service.depositAmountCents),
        `${row.amount_minor} vs ${service.depositAmountCents}`);
      check('team member assigned', row.staff_count > 0, `${row.staff_count} assigned`);
      check('outbox event raised', row.outbox_count > 0, `${row.outbox_count} events`);
    }
  } finally {
    await cleanup(pool, bookingId, slotId);

    // Teardown must have unwound the projection completely.
    if (bookingId) {
      const left = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM public.chime_bookings WHERE id = $1) AS bookings,
           (SELECT count(*)::int FROM chime_app.appointments WHERE id = $1) AS appointments,
           (SELECT count(*)::int FROM chime_app.widget_booking_links WHERE widget_booking_id = $1) AS links,
           (SELECT count(*)::int FROM chime_app.payments WHERE appointment_id = $1) AS payments`,
        [bookingId],
      );
      const l = left.rows[0];
      const clean = l.bookings + l.appointments + l.links + l.payments === 0;
      check('teardown unwound the projection', clean, JSON.stringify(l));
    }

    await pool.end();
    console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
