/*
 * Proves the two things that matter about error reporting.
 *
 * One: with no DSN it does nothing at all — the case every developer and every
 * test run is in, where a crash in the reporting path would be a self-inflicted
 * wound.
 *
 * Two: when it is on, a customer's name, email, phone and notes do not leave
 * the building. This is a booking system; a report that carries the request
 * body is a data breach with a stack trace attached, and it is the default
 * behaviour of the SDK underneath.
 *
 *   npx tsx src/observabilitySmoke.ts
 */

import assert from 'node:assert/strict';

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, run: () => void) {
  try {
    run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

// --- dormant -------------------------------------------------------------
delete process.env.CHIME_SENTRY_DSN;
const observability = await import('./observability.js');
const quiet = observability;

check('does nothing without a DSN', () => {
  quiet.initErrorReporting('smoke');
  assert.equal(quiet.isErrorReportingOn(), false, 'reporting should stay off with no DSN');
});

check('reporting an error without a DSN is harmless', () => {
  quiet.reportError(new Error('nobody is listening'), { service: 'smoke' });
});

check('flushing without a DSN resolves', () => {
  void quiet.flushErrorReports(50);
});

/*
 * --- what would actually be sent ---
 *
 * The module hands one options object to Sentry.init, and this is that object.
 * Inspecting it means the test reads the real configuration and calls the real
 * scrub, rather than a restatement of either.
 */
process.env.CHIME_SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
const options = quiet.sentryOptions('smoke') as unknown as Record<string, unknown>;

check('a DSN is carried into the options', () => {
  assert.equal(options.dsn, process.env.CHIME_SENTRY_DSN);
});

check('performance tracing stays off', () => {
  assert.equal(options.tracesSampleRate, 0);
  assert.equal(options.sendDefaultPii, false);
});

check('the scrub is the one Sentry will call', () => {
  assert.equal(options.beforeSend, quiet.scrub, 'beforeSend must be the exported scrub, not a copy');
});

check('a customer booking is stripped before it is sent', () => {
  const beforeSend = options.beforeSend as (event: unknown) => Record<string, unknown>;
  const event = beforeSend({
    request: {
      url: 'https://book.example.com/api/chime/bookings?token=secret-approval-token',
      query_string: 'token=secret-approval-token',
      method: 'POST',
      data: {
        customer: { name: 'Maya Kealoha', email: 'maya@example.invalid', phone: '+18085550123' },
        paymentIntentId: 'pi_live_realpayment',
      },
      cookies: { session: 'abc' },
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer a-real-token',
        cookie: 'session=abc',
        'user-agent': 'iPhone',
      },
    },
    user: { id: 'user-1', email: 'owner@example.invalid', username: 'owner' },
  });

  const serialized = JSON.stringify(event);
  for (const secret of [
    'Maya Kealoha',
    'maya@example.invalid',
    '+18085550123',
    'pi_live_realpayment',
    'a-real-token',
    'secret-approval-token',
    'owner@example.invalid',
  ]) {
    assert.ok(!serialized.includes(secret), `"${secret}" must not survive the scrub — got ${serialized}`);
  }

  const request = (event as { request: Record<string, unknown> }).request;
  assert.equal(request.method, 'POST', 'the method has to survive; it says which route broke');
  assert.equal(request.url, 'https://book.example.com/api/chime/bookings', 'the path survives, the query does not');
  assert.deepEqual(
    Object.keys(request.headers as Record<string, unknown>).sort(),
    ['content-type', 'user-agent'],
    'only the headers that describe the request itself survive',
  );
  assert.deepEqual((event as { user: unknown }).user, { id: 'user-1' }, 'an id, and nothing else about a person');
});

for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}${result.ok ? '' : ` — ${result.detail}`}`);
}
const failed = results.filter((result) => !result.ok).length;
if (results.length === 0) {
  console.error('\n  FAIL  nothing was checked.');
  process.exit(1);
}
console.log(failed === 0 ? `\n  PASS  ${results.length} error-reporting checks` : `\n  FAIL  ${failed} of ${results.length}`);
process.exit(failed === 0 ? 0 : 1);
