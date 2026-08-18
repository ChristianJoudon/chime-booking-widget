/*
 * Error reporting, off until someone turns it on.
 *
 * Without a DSN every function here is a no-op — no SDK started, no network
 * calls, no behaviour change. That is deliberate: a business running this on
 * one box with no error service should not pay for the wiring, and neither
 * should the test suite.
 *
 * Set CHIME_SENTRY_DSN and it starts reporting. Nothing else has to change.
 */

import * as Sentry from '@sentry/node';

/*
 * Read when asked, not when this module is first imported.
 *
 * Module-level capture works in production, where the environment is set before
 * anything starts, and quietly breaks anything that wants to check both states
 * — a test cannot un-import a module to see what happens when the variable
 * changes. Reading at the call site costs one property lookup at startup and
 * makes the off case and the on case equally testable.
 */
function dsn(): string | undefined {
  const value = process.env.CHIME_SENTRY_DSN?.trim();
  return value || undefined;
}

let started = false;

/*
 * What must never leave this building.
 *
 * This is a booking system. A request body on the customer API is somebody's
 * name, email address, phone number and the time they will be alone in a
 * building; on the administrator API it is that plus notes a business wrote
 * about them. An error report that carries those is a data breach with a stack
 * trace attached, and it is the default behaviour of most reporting SDKs.
 *
 * So bodies are dropped whole rather than filtered. A filter is a list of the
 * fields someone thought of, and the next field added to a form is not on it.
 * The path, the method and the status say which code broke, which is what a
 * stack trace is for; if a specific value is needed to understand a fault,
 * attach it deliberately at the call site, not by sweeping up the request.
 */
const SAFE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'content-type',
  'content-length',
  'user-agent',
  'origin',
  'referer',
]);

/*
 * Exported so it can be tested directly.
 *
 * The alternative was reaching into the SDK to intercept what init was handed,
 * which ES modules will not allow and which would have tested a copy of the
 * wiring rather than the wiring. `sentryOptions` below is the single object
 * production passes to init, so a test that inspects it is looking at the real
 * configuration and the real scrub.
 */
export function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    // The query string carries approval tokens on the customer-action links.
    if (event.request.query_string) event.request.query_string = '[stripped]';
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([name]) => SAFE_HEADERS.has(name.toLowerCase())),
      );
    }
  }
  // Usernames and emails are attached by the SDK's default integrations; the
  // organisation and role are enough to tell one tenant's fault from another's.
  if (event.user) {
    event.user = { id: event.user.id, ...(event.user.segment ? { segment: event.user.segment } : {}) };
  }
  return event;
}

export function sentryOptions(service: string): Sentry.NodeOptions {
  return {
    dsn: dsn(),
    environment: process.env.CHIME_WORKSPACE_ENV ?? 'unknown',
    release: process.env.CHIME_RELEASE,
    // Errors only. Performance tracing on a booking API would sample request
    // URLs and durations for every customer, which is a lot of data collected
    // about people to answer a question nobody has asked yet.
    tracesSampleRate: 0,
    // The SDK reads bodies by default. This is the belt to the scrub's braces.
    sendDefaultPii: false,
    beforeSend: scrub,
    initialScope: { tags: { service } },
  };
}

export function initErrorReporting(service: string): void {
  if (!dsn() || started) return;
  Sentry.init(sentryOptions(service));
  started = true;
  console.log(`Error reporting is on for ${service}.`);
}

export function isErrorReportingOn(): boolean {
  return started;
}

/*
 * Report a fault and carry on.
 *
 * Never throws. An error inside the thing that reports errors must not become
 * the error that takes the process down — and a booking that fails because the
 * reporting service was unreachable would be a self-inflicted outage.
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!started) return;
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) scope.setTag(key, String(value));
      Sentry.captureException(error);
    });
  } catch (reportingError) {
    console.error('Could not report an error', reportingError);
  }
}

/*
 * The two ways a Node process dies without anyone finding out.
 *
 * An unhandled rejection or an uncaught exception in a background path leaves
 * no request to attach a 500 to and no customer to see it. Installed for every
 * service, and left logging when reporting is off, because a crash reason
 * printed to the container log is still better than a silent restart.
 */
export function installProcessGuards(service: string): void {
  process.on('unhandledRejection', (reason) => {
    console.error(`Unhandled rejection in ${service}`, reason);
    reportError(reason, { service, kind: 'unhandledRejection' });
  });
  process.on('uncaughtException', (error) => {
    console.error(`Uncaught exception in ${service}`, error);
    reportError(error, { service, kind: 'uncaughtException' });
    // Deliberately not exiting. Express has already answered whatever request
    // was in flight, and a booking API that kills itself over one bad code path
    // turns a single failed request into an outage for everyone mid-booking.
    // The container's health check is what decides the process is beyond help.
  });
}

export async function flushErrorReports(timeoutMs = 2000): Promise<void> {
  if (!started) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // A shutdown that hangs waiting to report is worse than a lost report.
  }
}
