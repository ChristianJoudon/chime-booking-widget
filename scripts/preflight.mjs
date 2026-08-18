#!/usr/bin/env node
/**
 * Checks that a deployment is configured coherently before it serves anyone.
 *
 * The failure this exists to prevent is a workspace that looks live and is not:
 * a studio saying deposits are being collected while the payment provider is a
 * demo stub, or confirmations that appear sent while nothing left the building.
 * Those are quiet, and the business finds out from a customer.
 *
 * Every check reports what it looked at, so a pass is evidence rather than
 * silence. Run it in the release pipeline and again after deploy.
 *
 * Usage:
 *   npm run preflight
 */

import { createRequire } from 'node:module';
import process from 'node:process';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const DATABASE_URL = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
const ENVIRONMENT = process.env.CHIME_WORKSPACE_ENV ?? 'demo';

const failures = [];
const warnings = [];
const passes = [];

const ok = (what, detail) => passes.push(detail ? `${what} — ${detail}` : what);
const fail = (what, detail) => failures.push({ what, detail });
const warn = (what, detail) => warnings.push({ what, detail });

/** Secrets that must exist and must not be a placeholder. */
function checkSecret(name, { required = true, minLength = 16 } = {}) {
  const value = process.env[name];
  if (!value) {
    if (required) fail(name, 'not set');
    else warn(name, 'not set');
    return null;
  }
  if (/^(changeme|placeholder|your[-_]|xxx|todo)/i.test(value)) {
    fail(name, 'still a placeholder value');
    return null;
  }
  if (value.length < minLength) {
    fail(name, `only ${value.length} characters; use at least ${minLength}`);
    return null;
  }
  ok(name, `set, ${value.length} characters`);
  return value;
}

function checkEnvironmentCoherence() {
  const demoPayments = process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true';
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
  const notifications = process.env.CHIME_NOTIFICATION_MODE ?? 'sandbox';

  if (ENVIRONMENT !== 'live') {
    ok('workspace environment', `${ENVIRONMENT} — real money and real messages are off`);
    return;
  }

  // Live is the only value that carries a promise to a customer.
  if (demoPayments) {
    fail('live workspace', 'CHIME_ALLOW_DEMO_PAYMENTS is true, so demo payment identifiers would be accepted as real');
  } else {
    ok('live workspace', 'demo payment identifiers are refused');
  }

  if (!stripeKey) {
    fail('payments', 'CHIME_WORKSPACE_ENV is live but STRIPE_SECRET_KEY is not set');
  } else if (stripeKey.startsWith('sk_test_')) {
    fail('payments', 'a live workspace is configured with a Stripe test key, so no card is ever really charged');
  } else if (stripeKey.startsWith('sk_live_')) {
    ok('payments', 'Stripe live key present');
  } else {
    fail('payments', 'STRIPE_SECRET_KEY is not recognisably a Stripe key');
  }

  if (notifications !== 'live') {
    fail('notifications', `a live workspace with CHIME_NOTIFICATION_MODE=${notifications} confirms nothing to customers`);
  } else {
    checkSecret('RESEND_API_KEY');
    ok('notifications', 'live delivery enabled');
  }
}

async function checkDatabase() {
  if (!DATABASE_URL) {
    fail('database', 'CHIME_DATABASE_URL is not set');
    return;
  }
  const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await pool.query('SELECT 1');
    ok('database', 'reachable');

    // Every migration in the repository has to have been applied. A server
    // running against a database one migration behind fails later, in a
    // request, rather than here.
    // The name the migration runner uses. Guessing it wrong is how a preflight
    // reports a healthy deployment as broken, which is its own kind of failure.
    const { rows: ledger } = await pool.query(
      `SELECT count(*)::int AS applied FROM public.chime_schema_migrations`,
    ).catch(() => ({ rows: [{ applied: null }] }));
    if (ledger[0].applied === null) {
      fail('migrations', 'public.chime_schema_migrations is missing; run npm run migrate');
    } else {
      const { readdir } = await import('node:fs/promises');
      const files = (await readdir(new URL('../database/migrations', import.meta.url)))
        .filter((f) => f.endsWith('.sql'));
      if (ledger[0].applied < files.length) {
        fail('migrations', `${ledger[0].applied} applied but ${files.length} exist; run npm run migrate`);
      } else {
        ok('migrations', `${ledger[0].applied} applied`);
      }
    }

    // A live workspace with demo records in it will show them to customers.
    if (ENVIRONMENT === 'live') {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS demo FROM chime_app.services WHERE origin <> 'business'`,
      );
      if (rows[0].demo > 0) {
        warn('demo records', `${rows[0].demo} non-business service(s) present in a live workspace`);
      } else {
        ok('demo records', 'none in a live workspace');
      }
    }

    const { rows: owners } = await pool.query(
      `SELECT count(*)::int AS n FROM chime_app.user_credentials`,
    );
    if (owners[0].n === 0) {
      fail('sign-in', 'no account has a password; nobody can sign in to the studio');
    } else {
      ok('sign-in', `${owners[0].n} account(s) can sign in`);
    }
  } catch (error) {
    fail('database', error.message.slice(0, 120));
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  checkSecret('CHIME_ADMIN_SESSION_SECRET', { minLength: 32 });
  checkEnvironmentCoherence();
  await checkDatabase();

  for (const line of passes) console.log(`  ok    ${line}`);
  for (const w of warnings) console.log(`  WARN  ${w.what} — ${w.detail}`);
  for (const f of failures) console.log(`  FAIL  ${f.what} — ${f.detail}`);

  if (failures.length) {
    console.log(`\nFAIL  ${failures.length} problem(s) would affect customers. Not safe to serve.`);
    process.exit(1);
  }
  console.log(`\nPASS  ${passes.length} checks${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
