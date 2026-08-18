#!/usr/bin/env node
/**
 * Cross-workspace contract checks.
 *
 * The tightening plan's first instruction is not to redesign screens until
 * "Services, Team, Availability, Customers, Widget Designer, and Launch all
 * report the same organization data". This checks that they do.
 *
 * The product is two applications over one database. The administrator studio
 * mostly works in `chime_app.*`; the customer widget mostly works in
 * `public.chime_*`. Where those meet is a contract, and a contract that nothing
 * enforces is a guess:
 *
 *   services         admin writes chime_app.services
 *                    widget reads public.chime_services
 *   availability     admin's engine writes public.chime_availability_slots
 *                    widget reads the same table
 *   widget config    both use chime_app.widget_configs
 *   bookings         widget writes public.chime_bookings, a trigger projects
 *                    into chime_app.* (migration 005)
 *
 * Each check below asks one question a business owner would ask: "I changed
 * this — did my customers see it?" That is deliberately not the same as "did
 * the write succeed", which is what an API test would tell you.
 *
 * Everything it creates is removed at the end, and the run reports what it
 * could not clean up rather than leaving it silently.
 *
 * Usage:
 *   npm run test:contracts
 *
 * Requires both APIs running (8887 customer, 8888 administrator) and the
 * CHIME_ADMIN_SESSION_SECRET the admin API was started with:
 *   set -a; . ./server/.env; set +a; npm run test:contracts
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';

const ADMIN = (process.env.CHIME_ADMIN_API_BASE_URL
  ?? 'http://127.0.0.1:8888/api/chime/admin').replace(/\/+$/, '');
const WIDGET = (process.env.CHIME_BOOKING_API_BASE_URL
  ?? 'http://127.0.0.1:8887/api/chime').replace(/\/+$/, '');
const SECRET = process.env.CHIME_ADMIN_SESSION_SECRET;
const ORGANIZATION_ID = process.env.CHIME_ADMIN_ORGANIZATION_ID
  ?? '00000000-0000-4000-8000-000000000001';
const USER_ID = process.env.CHIME_ADMIN_USER_ID
  ?? '00000000-0000-4000-8000-000000000101';

const failures = [];
const passes = [];
const cleanupProblems = [];

function check(name, condition, detail) {
  if (condition) passes.push(name);
  else failures.push({ name, detail });
}

function mintSession() {
  if (!SECRET) {
    console.error(
      'CHIME_ADMIN_SESSION_SECRET is not set. Run with the admin API\'s own\n'
      + 'environment, for example:\n'
      + '  set -a; . ./server/.env; set +a; npm run test:contracts',
    );
    process.exit(2);
  }
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    subject: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: 'owner',
    email: 'contract-check@chime.local',
    expiresAt: now + 3600,
    issuer: 'chime-admin',
    issuedAt: now,
  })).toString('base64url');
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

const token = mintSession();

async function adminRequest(path, { method = 'GET', body, version } = {}) {
  const response = await fetch(`${ADMIN}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // Every admin write requires both; omitting either is a 400 that reads
      // like a validation failure rather than a missing header.
      ...(method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() }),
      ...(version === undefined ? {} : { 'If-Match': `"${version}"` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${method} ${path}: ${message}`);
  }
  return payload;
}

async function widgetRequest(path) {
  const response = await fetch(`${WIDGET}${path}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${path}: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

/** What the studio shows a business owner on the Services screen. */
async function studioServices() {
  const { services } = await adminRequest('/services');
  return services.filter((service) => service.origin !== 'test');
}

/** What a customer is actually offered. */
async function widgetServices() {
  const { services } = await widgetRequest('/services');
  return services;
}

const deposit = (service) => (service.deposit?.mode === 'fixed'
  ? service.deposit.fixedAmountMinor ?? 0
  : 0);

/* ------------------------------------------------------------------ *
 * Contract 1: a service the studio publishes is the service customers
 * are offered — same name, same length, same deposit.
 * ------------------------------------------------------------------ */
async function checkServicesAgree() {
  const studio = await studioServices();
  const widget = await widgetServices();

  const bookable = studio.filter((service) => service.isActive && service.isPublic);
  const widgetById = new Map(widget.map((service) => [service.id, service]));

  const missing = bookable.filter((service) => !widgetById.has(service.id));
  check(
    'every published service is offered to customers',
    missing.length === 0,
    missing.length
      ? `the studio publishes ${missing.length} service(s) the widget does not offer: `
        + missing.map((s) => s.name).join(', ')
      : undefined,
  );

  const studioById = new Map(studio.map((service) => [service.id, service]));
  const orphaned = widget.filter((service) => !studioById.has(service.id));
  check(
    'customers are offered nothing the studio does not know about',
    orphaned.length === 0,
    orphaned.length
      ? `the widget offers ${orphaned.length} service(s) absent from the studio: `
        + orphaned.map((s) => `${s.name} (${s.id})`).join(', ')
      : undefined,
  );

  const disagreements = [];
  for (const service of bookable) {
    const offered = widgetById.get(service.id);
    if (!offered) continue;
    if (offered.name !== service.name) {
      disagreements.push(`${service.id}: studio calls it "${service.name}", customers see "${offered.name}"`);
    }
    if (offered.durationMinutes !== service.duration.defaultMinutes) {
      disagreements.push(`${service.name}: studio says ${service.duration.defaultMinutes} min, customers see ${offered.durationMinutes} min`);
    }
    if ((offered.depositAmountCents ?? 0) !== deposit(service)) {
      disagreements.push(`${service.name}: studio deposit ${deposit(service)}, customers see ${offered.depositAmountCents ?? 0}`);
    }
  }
  check(
    'name, length and deposit match on both sides',
    disagreements.length === 0,
    disagreements.join('\n        '),
  );
}

/* ------------------------------------------------------------------ *
 * Contract 2: editing a service in the studio changes what customers
 * are offered. This is the one a business owner would notice first.
 * ------------------------------------------------------------------ */
async function checkEditReachesCustomers() {
  const studio = await studioServices();
  const subject = studio.find((service) => service.isActive && service.isPublic);
  if (!subject) {
    check('an edit in the studio reaches customers', false, 'no published service to edit');
    return null;
  }

  const marker = `Contract check ${Date.now()}`;
  const original = { name: subject.name, version: subject.version };

  await adminRequest(`/services/${subject.id}`, {
    method: 'PUT',
    version: subject.version,
    body: { ...subject, name: marker },
  });

  const offered = (await widgetServices()).find((service) => service.id === subject.id);
  check(
    'an edit in the studio reaches customers',
    offered?.name === marker,
    offered
      ? `renamed to "${marker}" in the studio, but customers are still offered "${offered.name}". `
        + 'chime_app.services and public.chime_services are separate tables with nothing between them.'
      : 'the edited service disappeared from the customer list entirely',
  );

  return { id: subject.id, ...original };
}

/* ------------------------------------------------------------------ *
 * Contract 3: unpublishing takes a service off the customer widget.
 * A service an owner has hidden must not still be bookable.
 * ------------------------------------------------------------------ */
async function checkUnpublishHides(restore) {
  if (!restore) return;
  const current = (await studioServices()).find((service) => service.id === restore.id);
  if (!current) return;

  await adminRequest(`/services/${current.id}`, {
    method: 'PUT',
    version: current.version,
    body: { ...current, isPublic: false },
  });

  const stillOffered = (await widgetServices()).some((service) => service.id === current.id);
  check(
    'unpublishing a service removes it from the customer widget',
    !stillOffered,
    stillOffered
      ? 'the service is hidden in the studio but customers can still book it'
      : undefined,
  );
}

/* ------------------------------------------------------------------ *
 * Contract 4: the studio's availability preview and the times a
 * customer can actually pick describe the same calendar.
 * ------------------------------------------------------------------ */
async function checkAvailabilityAgrees() {
  // POST, not GET: the preview recalculates from the saved schedule.
  const preview = await adminRequest('/availability/preview', {
    method: 'POST',
    body: { horizonDays: 30 },
  });
  const summary = preview.summary ?? preview;

  const service = (await widgetServices())[0];
  if (!service) {
    check('the studio preview and customer calendar agree', false, 'no bookable service to query');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const customer = await widgetRequest(
    `/availability?serviceId=${encodeURIComponent(service.id)}&startDate=${today}`,
  );
  const slots = customer.slots ?? customer.availability ?? [];

  // Both sides claiming zero is agreement, but it is also what a broken
  // connection looks like, so it is reported rather than passed silently.
  const studioCount = Number(summary.slotCount ?? 0);
  if (studioCount === 0 && slots.length === 0) {
    check(
      'the studio preview and customer calendar agree',
      true,
    );
    console.log('NOTE  both sides report zero bookable times; agreement here is weak evidence.');
    return;
  }

  check(
    'the studio preview and customer calendar agree',
    (studioCount > 0) === (slots.length > 0),
    `the studio previews ${studioCount} bookable time(s) but customers see ${slots.length}`,
  );
}

/* ------------------------------------------------------------------ *
 * Contract 5: widget appearance saved in the studio is the appearance
 * the customer widget serves.
 * ------------------------------------------------------------------ */
async function checkWidgetAppearanceAgrees() {
  const { config } = await adminRequest('/widget-config');
  const { slug, organizationSlug, isActive, id, theme = {} } = config ?? {};

  const response = await fetch(`${WIDGET}/widget-config/${organizationSlug}/${slug}`);
  const served = response.ok ? await response.json().catch(() => null) : null;

  // id === null means the studio is showing a starting point rather than a
  // saved design. That is a reasonable thing to show an owner who has not
  // customised anything, but it must not claim to be live: nothing is stored,
  // so the public endpoint has nothing to serve.
  if (id === null) {
    check(
      'an unsaved widget design does not claim to be live',
      isActive !== true,
      'the studio reports isActive: true for a design that was never saved. '
      + `The public endpoint returns ${response.status} because chime_app.widget_configs `
      + 'holds no row for this organization.',
    );
    check(
      'an unsaved widget design is not served to customers',
      !response.ok,
      'the public endpoint serves a design the studio has not saved',
    );
    return;
  }

  if (!isActive) {
    check(
      'a deactivated widget design is not served to customers',
      !response.ok,
      'the studio has this design switched off but customers are still served it',
    );
    return;
  }

  check(
    'an active widget design is served to customers',
    response.ok,
    `the studio reports this design active, but the public endpoint returns ${response.status}`,
  );
  if (!response.ok) return;

  const servedTheme = served?.config?.theme ?? served?.theme ?? {};
  const differing = Object.keys(theme).filter(
    (key) => key in servedTheme && JSON.stringify(theme[key]) !== JSON.stringify(servedTheme[key]),
  );
  check(
    'the widget serves the appearance saved in the studio',
    differing.length === 0,
    differing.map((key) => `${key}: studio ${theme[key]}, customers see ${servedTheme[key]}`).join('\n        '),
  );
}

/* ------------------------------------------------------------------ *
 * Contract 6: records marked as tests stay out of what a business and
 * its customers see.
 * ------------------------------------------------------------------ */
async function checkProjectionHandlesEveryCase(pool) {
  // The trigger added in migration 019 has three branches — insert/update,
  // test-origin removal, and delete. The admin API filters test records out of
  // its own list, so the quarantine branch cannot be reached through the API at
  // all; going to the database directly is the only way to check it rather than
  // assume it.
  // Cloned from a real service rather than hand-built: the create endpoint
  // validates every field, and a literal payload here would break each time one
  // is added. This is also what Duplicate does in the studio.
  const template = (await studioServices()).find((item) => item.isActive && item.isPublic);
  if (!template) {
    check('a service created in the studio is offered to customers', false,
      'no published service to clone');
    return;
  }
  const stamp = Date.now();
  const created = await adminRequest('/services', {
    method: 'POST',
    body: {
      ...template,
      id: `draft-${stamp}`,
      name: `Contract projection ${stamp}`,
      slug: `contract-projection-${stamp}`,
      deposit: { mode: 'fixed', currency: template.currency ?? 'USD', fixedAmountMinor: 1500, refundable: true },
      isActive: true,
      isPublic: true,
      version: 1,
    },
  });
  const service = created.service ?? created;

  try {
    const offered = (await widgetServices()).find((item) => item.id === service.id);
    check(
      'a service created in the studio is offered to customers',
      Boolean(offered),
      'the new service never reached the customer widget',
    );
    // The withdraw and restore checks below both ask whether a service left or
    // returned. If it was never there, "absent" is not evidence of anything —
    // they would pass while the projection was entirely broken. Skipping keeps
    // a green result meaning what it says.
    if (!offered) {
      console.log('NOTE  withdraw and restore not checked: the service never reached the widget.');
      return;
    }
    check(
      'a new service carries its deposit to customers',
      offered?.depositAmountCents === 1500,
      `expected a 1500 deposit, customers see ${offered?.depositAmountCents}`,
    );

    await pool.query(
      `UPDATE chime_app.services SET origin = 'test' WHERE id = $1`,
      [service.id],
    );
    const afterQuarantine = (await widgetServices()).some((item) => item.id === service.id);
    check(
      'a service marked as a test is withdrawn from customers',
      !afterQuarantine,
      'a test-origin service is still offered to paying customers',
    );

    await pool.query(
      `UPDATE chime_app.services SET origin = 'business' WHERE id = $1`,
      [service.id],
    );
    const afterRestore = (await widgetServices()).some((item) => item.id === service.id);
    check(
      'marking a service as business again restores it for customers',
      afterRestore,
      'the service did not come back after its origin was restored',
    );
  } finally {
    // Deleted through the database rather than the API, which archives rather
    // than removes — and deleting is the trigger branch still unexercised.
    // Whether the customer-facing row existed before the delete decides what
    // its absence afterwards proves. If it was never projected, "gone" says
    // nothing about the delete path.
    const projectedBefore = await pool.query(
      `SELECT 1 FROM public.chime_services WHERE admin_service_id = $1`,
      [service.id],
    );
    await pool.query(`DELETE FROM chime_app.services WHERE id = $1`, [service.id]);
    const leftBehind = await pool.query(
      `SELECT 1 FROM public.chime_services WHERE admin_service_id = $1`,
      [service.id],
    );
    if (projectedBefore.rowCount === 0) {
      console.log('NOTE  delete not checked: the service had no customer-facing row to remove.');
    } else {
      check(
        'deleting a service removes it from the customer widget',
        leftBehind.rowCount === 0,
        'the service was deleted in the studio but its customer-facing row remains',
      );
    }
  }
}

async function restoreService(restore) {
  if (!restore) return;
  try {
    const current = (await studioServices()).find((service) => service.id === restore.id);
    if (!current) {
      cleanupProblems.push(`service ${restore.id} could not be found to restore`);
      return;
    }
    await adminRequest(`/services/${current.id}`, {
      method: 'PUT',
      version: current.version,
      body: { ...current, name: restore.name, isPublic: true },
    });
    const after = (await studioServices()).find((service) => service.id === restore.id);
    if (after?.name !== restore.name || after?.isPublic !== true) {
      cleanupProblems.push(
        `service ${restore.id} did not restore cleanly: name="${after?.name}" isPublic=${after?.isPublic}`,
      );
    }
  } catch (error) {
    cleanupProblems.push(`restoring service ${restore.id}: ${error.message}`);
  }
}

/*
 * An appointment written down in the studio takes that time off the widget.
 *
 * This is the contract that used to be broken in the one direction nothing
 * could reach: a customer booking always left a record the widget's own
 * capacity query understood, so the two sides agreed by accident rather than by
 * design. The moment an administrator can enter a phone booking, the accident
 * stops covering it.
 *
 * Measured on the same team member's own slots, before and after, and then the
 * appointment is removed and the capacity has to come back. A check that only
 * looked at "after" would pass just as happily against a slot that was never
 * available in the first place.
 */
async function checkStudioBookingBlocksTheWidget(pool) {
  const name = 'a studio appointment takes that time off the widget';

  const { rows: staffRows } = await pool.query(
    `SELECT candidate.staff_member_id, candidate.slot_id, candidate.busy_starts_at, candidate.busy_ends_at,
            slot.capacity, slot.status
       FROM public.chime_slot_candidates candidate
       JOIN public.chime_availability_slots slot ON slot.id = candidate.slot_id
      WHERE candidate.organization_id = $1
        AND slot.source = 'admin'
        AND slot.starts_at > now() + interval '10 days'
        AND slot.status = 'available'
      ORDER BY slot.starts_at
      LIMIT 1`,
    [ORGANIZATION_ID],
  );
  const target = staffRows[0];
  if (!target) {
    check(name, false, 'no future published slot with a candidate to test against');
    return;
  }

  const service = (await pool.query(
    `SELECT id, default_duration_minutes FROM chime_app.services
      WHERE organization_id = $1 AND origin <> 'test' AND is_active ORDER BY name LIMIT 1`,
    [ORGANIZATION_ID],
  )).rows[0];
  if (!service) {
    check(name, false, 'no active service to book');
    return;
  }

  const capacityOf = async () =>
    Number(
      (await pool.query('SELECT capacity FROM public.chime_availability_slots WHERE id = $1', [target.slot_id]))
        .rows[0].capacity,
    );

  const before = await capacityOf();
  let created = null;
  try {
    created = await adminRequest('/appointments', {
      method: 'POST',
      body: {
        serviceId: service.id,
        staffMemberId: target.staff_member_id,
        startsAt: new Date(target.busy_starts_at).toISOString(),
        durationMinutes: service.default_duration_minutes,
        customerName: `Contract probe ${Date.now()}`,
      },
    });
    const after = await capacityOf();

    check(
      name,
      after === before - 1,
      `capacity was ${before} and is ${after}; booking the only candidate for that slot should have taken one off`,
    );
  } catch (error) {
    check(name, false, `creating the appointment failed: ${error.message}`);
  } finally {
    if (created?.appointment?.id) {
      const appointmentId = created.appointment.id;
      await pool.query('DELETE FROM chime_app.audit_events WHERE entity_id = $1', [appointmentId]);
      await pool.query('DELETE FROM chime_app.outbox_events WHERE aggregate_id = $1', [appointmentId]);
      await pool.query('DELETE FROM chime_app.appointment_staff WHERE appointment_id = $1', [appointmentId]);
      const customer = await pool.query(
        'DELETE FROM chime_app.appointments WHERE id = $1 RETURNING customer_id',
        [appointmentId],
      );
      if (customer.rows[0]) {
        await pool.query('DELETE FROM chime_app.customers WHERE id = $1', [customer.rows[0].customer_id]);
      }
      await pool.query('SELECT public.chime_refresh_generated_slot_capacities($1)', [ORGANIZATION_ID]);

      // The other half of the contract, and the one a careless implementation
      // fails: cancelling has to give the hour back.
      const restored = await capacityOf();
      check(
        'removing that appointment puts the time back',
        restored === before,
        `capacity started at ${before} and came back as ${restored}`,
      );
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  let restore = null;
  try {
    await checkServicesAgree();
    restore = await checkEditReachesCustomers();
    await checkUnpublishHides(restore);
    await checkAvailabilityAgrees();
    await checkWidgetAppearanceAgrees();
    await checkProjectionHandlesEveryCase(pool);
    await checkStudioBookingBlocksTheWidget(pool);
  } finally {
    await restoreService(restore);
    await pool.end();
  }

  for (const name of passes) console.log(`  ok    ${name}`);
  for (const failure of failures) {
    console.log(`  FAIL  ${failure.name}`);
    if (failure.detail) console.log(`        ${failure.detail}`);
  }
  for (const problem of cleanupProblems) console.log(`  CLEANUP  ${problem}`);

  if (cleanupProblems.length) {
    console.log(`\nFAIL  ${cleanupProblems.length} cleanup problem(s): the database was left changed`);
    process.exit(1);
  }
  if (failures.length) {
    console.log(`\nFAIL  ${failures.length} of ${passes.length + failures.length} contracts broken`);
    process.exit(1);
  }
  console.log(`\nPASS  ${passes.length} contracts hold`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
