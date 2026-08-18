#!/usr/bin/env node
/*
 * Runs the whole integration suite against a live database, start to finish.
 *
 * Every smoke test in this repository expects servers that are already running.
 * That is fine at a keyboard, where the servers are up in another terminal, and
 * useless to a machine, which has nothing running and no terminal. This script
 * is the missing half: it migrates, seeds, starts what the tests need, mints
 * the sessions they authenticate with, runs them, and shuts everything down.
 *
 * It exists as a script rather than as steps in a workflow file on purpose. A
 * workflow can only be exercised by pushing to a branch and waiting; a script
 * can be run here, now, before anyone depends on it. The workflow calls this
 * and stays thin, so the part that is hard to test stays small.
 *
 *   node scripts/ci-integration.mjs
 *
 * Reads CHIME_DATABASE_URL. Everything else it derives or generates, so it
 * never depends on a developer's .env being present.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import process from 'node:process';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const databaseUrl = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('CHIME_DATABASE_URL is required.');
  process.exit(1);
}

const BOOKING_PORT = Number(process.env.CHIME_CI_BOOKING_PORT ?? 8887);
const ADMIN_PORT = Number(process.env.CHIME_CI_ADMIN_PORT ?? 8888);
const STUDIO_PORT = Number(process.env.CHIME_CI_STUDIO_PORT ?? 4374);
const WIDGET_PORT = Number(process.env.CHIME_CI_WIDGET_PORT ?? 5373);

/*
 * The browser suites run only where there is a browser.
 *
 * They are skipped rather than failed when Chrome is absent, and the skip is
 * printed. A machine without a browser is a legitimate place to run the rest of
 * this, and a suite that cannot run is not the same as one that ran and passed
 * — so it says which it was, every time, instead of quietly reporting nine of
 * nine and letting the reader assume eleven.
 */
const CHROME = [
  process.env.CHIME_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));

/*
 * Who the suite runs as, read out of the database after seeding rather than
 * written down here.
 *
 * Copying the identifiers into this file was the first attempt and they were
 * wrong, which is the whole argument against it: a constant here and a constant
 * in a seed file are two sources of truth that agree only until someone edits
 * one. Asking produces the answer that exists.
 */
async function readIdentities() {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query(
      `SELECT membership.organization_id, membership.user_id, membership.role
         FROM chime_app.memberships membership
         JOIN chime_app.organizations organization ON organization.id = membership.organization_id
        WHERE membership.role IN ('owner', 'viewer')
        ORDER BY organization.created_at, membership.role`,
    );
    const owner = rows.find((row) => row.role === 'owner');
    const viewer = rows.find((row) => row.role === 'viewer' && row.organization_id === owner?.organization_id);
    if (!owner) {
      throw new Error(
        'No organisation with an owner exists after seeding. The suite cannot authenticate as anyone, and every ' +
          'test after this point would fail for the same reason — so it stops here, where the cause is legible.',
      );
    }
    if (!viewer) {
      throw new Error(
        'The seeded organisation has no viewer. Several tests assert a read-only role is refused where an owner ' +
          'is allowed; without one they would silently only ever exercise the permitted half.',
      );
    }
    return {
      organizationId: owner.organization_id,
      ownerUserId: owner.user_id,
      viewerUserId: viewer.user_id,
    };
  } finally {
    await pool.end();
  }
}

const env = {
  ...process.env,
  CHIME_DATABASE_URL: databaseUrl,
  DATABASE_URL: databaseUrl,
  PORT: String(BOOKING_PORT),
  CHIME_ADMIN_PORT: String(ADMIN_PORT),
  CHIME_BOOKING_API_BASE_URL: `http://127.0.0.1:${BOOKING_PORT}/api/chime`,
  CHIME_ADMIN_API_BASE_URL: `http://127.0.0.1:${ADMIN_PORT}/api/chime/admin`,
  CHIME_ADMIN_API_URL: `http://127.0.0.1:${ADMIN_PORT}`,
  CHIME_ADMIN_BASE_URL: `http://127.0.0.1:${ADMIN_PORT}`,
  // Generated per run. A fixed secret in a repository is a secret that ends up
  // in production by accident, and nothing here outlives the process.
  CHIME_ADMIN_SESSION_SECRET: process.env.CHIME_ADMIN_SESSION_SECRET ?? randomBytes(32).toString('hex'),
  CHIME_ADMIN_ALLOWED_ORIGINS: 'http://localhost:4374,http://127.0.0.1:4374',
  CHIME_WORKSPACE_ENV: 'test',
  // The suite books appointments without a card. Demo payments are the
  // mechanism for that, and the workspace is marked test so the coherence check
  // that guards this in production is satisfied honestly rather than bypassed.
  CHIME_ALLOW_DEMO_PAYMENTS: 'true',
  CHIME_NOTIFICATION_MODE: 'sandbox',
  CHIME_NOTIFICATION_POLL_MS: '1000',
  CHIME_TIME_ZONE: 'Pacific/Honolulu',
  CHIME_CURRENCY: 'USD',
  CHIME_CUSTOMER_APPROVAL_URL: 'http://127.0.0.1:4375',
  CHIME_REQUIRE_DEPOSIT: 'false',
  CHIME_STUDIO_URL: `http://localhost:${STUDIO_PORT}/admin.html`,
  CHIME_WIDGET_URL: `http://localhost:${WIDGET_PORT}/`,
  ...(CHROME ? { CHIME_CHROME_PATH: CHROME } : {}),
};

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'inherit'], ...options });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}

function background(name, command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const prefix = `[${name}] `;
  child.stdout.on('data', (chunk) => process.stdout.write(prefix + chunk.toString().replace(/\n(?!$)/g, `\n${prefix}`)));
  child.stderr.on('data', (chunk) => process.stderr.write(prefix + chunk.toString().replace(/\n(?!$)/g, `\n${prefix}`)));
  child.on('exit', (code) => {
    // A server that dies mid-suite would otherwise show up as a wall of
    // connection-refused failures in whichever test happened to run next.
    if (!shuttingDown && code !== 0) console.error(`${prefix}exited unexpectedly with ${code}`);
  });
  children.push(child);
  return child;
}

async function waitForHealth(label, url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // 503 is a healthy answer from a service that is up and telling us
      // something else is wrong, so any response at all means it is listening.
      if (response.status < 500 || response.status === 503) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${label} never became reachable at ${url} (${lastError})`);
}

async function shutdown() {
  shuttingDown = true;
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 4000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  );
}

const results = [];
const skipped = [];
async function step(name, work) {
  const label = name.padEnd(30);
  try {
    await work();
    results.push({ name, ok: true });
    console.log(`\n  PASS  ${label}\n`);
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.error(`\n  FAIL  ${label}${error instanceof Error ? error.message : error}\n`);
  }
}

try {
  console.log('--- schema and data ---');
  await run('node', ['scripts/migrate.mjs']);
  await run('node', ['scripts/seed-demo.mjs']);

  const identities = await readIdentities();
  env.CHIME_ADMIN_ORGANIZATION_ID = identities.organizationId;
  env.CHIME_PUBLIC_ORGANIZATION_ID = identities.organizationId;
  env.CHIME_ADMIN_USER_ID = identities.ownerUserId;
  console.log(`  running against organisation ${identities.organizationId}`);

  console.log('\n--- servers ---');
  background('booking', 'npx', ['tsx', 'src/index.ts'], { cwd: 'server' });
  background('admin', 'npx', ['tsx', 'src/admin/index.ts'], { cwd: 'server' });
  background('worker', 'npx', ['tsx', 'src/notifications/worker.ts'], { cwd: 'server' });
  await Promise.all([
    waitForHealth('booking API', `http://127.0.0.1:${BOOKING_PORT}/api/chime/health`),
    waitForHealth('admin API', `http://127.0.0.1:${ADMIN_PORT}/api/chime/admin/health`),
  ]);

  console.log('\n--- sessions ---');
  env.CHIME_ADMIN_OWNER_TOKEN = await capture('npx', ['tsx', 'src/admin/create-session.ts'], { cwd: 'server' });
  // A viewer token as well, because several tests assert that a read-only role
  // is refused where an owner is allowed. Without it they would only ever
  // exercise the permitted half and pass whatever the authorisation code did.
  env.CHIME_ADMIN_VIEWER_TOKEN = await capture('npx', ['tsx', 'src/admin/create-session.ts'], {
    cwd: 'server',
    env: { ...env, CHIME_ADMIN_USER_ID: identities.viewerUserId, CHIME_ADMIN_USER_ROLE: 'viewer', CHIME_ADMIN_USER_EMAIL: 'viewer@chime.local' },
  });
  env.CHIME_ADMIN_TOKEN = env.CHIME_ADMIN_OWNER_TOKEN;
  console.log(`  minted an owner and a viewer session`);

  console.log('\n--- suites ---');
  await step('admin API', () => run('node', ['scripts/admin-api-smoke.mjs']));
  await step('customer approval', () => run('node', ['scripts/customer-approval-smoke.mjs']));
  await step('notifications', () => run('node', ['scripts/notification-delivery-smoke.mjs']));
  await step('customer CRM', () => run('node', ['scripts/customer-crm-smoke.mjs']));
  await step('availability studio', () => run('node', ['scripts/availability-schedule-smoke.mjs']));
  await step('widget studio', () => run('node', ['scripts/widget-config-smoke.mjs']));
  await step('booking projection', () => run('node', ['scripts/booking-projection-smoke.mjs']));
  await step('cross-workspace contracts', () => run('node', ['scripts/cross-workspace-contract.mjs']));
  await step('payment safety', () => run('npx', ['tsx', 'src/paymentSafetySmoke.ts'], { cwd: 'server' }));

  if (!CHROME) {
    console.log('\n  SKIP  browser suites — no Chrome or Chromium found. Set CHIME_CHROME_PATH to include them.');
    skipped.push('accessibility', 'embed host styles');
  } else {
    // Needs no servers: it renders the built widget under host stylesheets.
    await step('embed host styles', () => run('node', ['scripts/embed-host-styles.mjs']));

    // Needs only Vite — the widget's dev entry renders from sample data, so this
    // measures the widget's shape without depending on a seed or a database.
    background('widget', 'npx', ['vite', '--port', String(WIDGET_PORT), '--strictPort']);
    await waitForHealth('widget dev server', `http://localhost:${WIDGET_PORT}/`, 90_000);
    await step('narrow layout', () => run('node', ['scripts/widget-narrow-layout.mjs']));

    // Needs the studio itself, which is the one thing not already running.
    background('studio', 'npx', ['vite', '--config', 'vite.admin.config.ts', '--port', String(STUDIO_PORT), '--strictPort']);
    await waitForHealth('admin studio', `http://localhost:${STUDIO_PORT}/admin.html`, 90_000);
    await step('accessibility', () => run('node', ['scripts/accessibility-smoke.mjs']));
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error instanceof Error ? error.message : String(error) });
  console.error(`\n  FAIL  setup${' '.repeat(26)}${error instanceof Error ? error.message : error}`);
} finally {
  await shutdown();
}

/*
 * Reported in a finally, and a run with nothing in it fails.
 *
 * A suite that exits zero because it never got as far as running anything is
 * the most expensive kind of green: it keeps reporting success for exactly as
 * long as nobody looks.
 */
const failed = results.filter((result) => !result.ok);
console.log(`\n${'='.repeat(60)}`);
for (const result of results) console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : ` — ${result.error}`}`);
for (const name of skipped) console.log(`  SKIP  ${name}`);
console.log(`${'='.repeat(60)}`);
if (results.length === 0) {
  console.error('  Nothing ran. Treating that as a failure.');
  process.exit(1);
}
console.log(`  ${results.length - failed.length}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
process.exit(failed.length === 0 ? 0 : 1);
