#!/usr/bin/env node
/**
 * Refreshes the practice data in the demo workspace.
 *
 * The demo schedule is timed relative to the current week, so running this
 * moves it forward. Without it the appointments stay where they were first
 * written and the studio gradually opens on an empty calendar — which is the
 * first screen anyone looks at.
 *
 * Safe to run repeatedly. Every row it writes has a fixed UUID and is restricted
 * to `origin = 'demo'`, so it refreshes its own records and cannot touch a real
 * appointment, customer or payment.
 *
 * Usage:
 *   npm run seed:demo
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';

/** In load order: customers, then the schedule that references them, then what hangs off it. */
const SEEDS = [
  '001-demo-customers.sql',
  '002-demo-schedule.sql',
  '004-demo-activity.sql',
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    for (const name of SEEDS) {
      const sql = await readFile(new URL(`../database/seeds/${name}`, import.meta.url), 'utf8');
      await pool.query(sql);
      console.log(`  applied ${name}`);
    }

    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*) FROM chime_app.appointments WHERE origin = 'demo') AS appointments,
        (SELECT count(*) FROM chime_app.appointments
          WHERE origin = 'demo'
            AND starts_at >= date_trunc('week', now())
            AND starts_at < date_trunc('week', now()) + interval '7 days') AS this_week,
        (SELECT count(*) FROM chime_app.customers WHERE origin = 'demo') AS customers,
        (SELECT count(*) FROM chime_app.payments p
           JOIN chime_app.appointments a ON a.id = p.appointment_id
          WHERE a.origin = 'demo') AS payments,
        (SELECT count(*) FROM chime_app.appointment_change_requests
          WHERE status = 'pending') AS open_requests,
        (SELECT count(*) FROM chime_app.customer_notes) AS notes
    `);
    const summary = rows[0];

    console.log('');
    console.log(`  ${summary.appointments} demo appointments, ${summary.this_week} of them this week`);
    console.log(`  ${summary.customers} customers, ${summary.payments} deposits, `
      + `${summary.open_requests} request awaiting a person, ${summary.notes} notes`);

    // The whole point is a schedule you can see, so a zero here is a failure
    // even though every statement succeeded.
    if (Number(summary.this_week) === 0) {
      console.log('\nFAIL  nothing landed in the current week');
      process.exitCode = 1;
      return;
    }
    console.log('\nPASS  practice data is current');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
