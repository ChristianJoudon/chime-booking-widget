import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { Pool } from 'pg';

import { requireAdminSession } from './auth.js';
import { createAdminRouter } from './routes.js';
import { createSessionRouter } from './sessionRoutes.js';
import { AdminApiError } from './types.js';
import { assertWorkspaceIsCoherent } from './workspaceEnvironment.js';
import { readWorkerStatus } from '../notifications/heartbeat.js';
import { flushErrorReports, initErrorReporting, installProcessGuards, reportError } from '../observability.js';

assertWorkspaceIsCoherent();

/*
 * Started before anything else can fail.
 *
 * Reporting installed after the first import that throws would miss exactly the
 * faults hardest to diagnose — the ones that happen before the service is
 * listening and leave nothing but an exit code.
 */
initErrorReporting('chime-admin-api');
installProcessGuards('chime-admin-api');

const port = Number(process.env.CHIME_ADMIN_PORT ?? 8888);
const connectionString = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('CHIME_DATABASE_URL or DATABASE_URL is required.');
}

const allowedOrigins = new Set(
  (process.env.CHIME_ADMIN_ALLOWED_ORIGINS
    ?? 'http://127.0.0.1:4373,http://localhost:4373,http://127.0.0.1:4374,http://localhost:4374')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const pool = new Pool({ connectionString });
const app = express();

app.disable('x-powered-by');
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, Idempotency-Key, X-Request-Id');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (request.method === 'OPTIONS') {
    response.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
    return;
  }
  next();
});
app.use(express.json({ limit: '96kb', strict: true }));
app.use((request, response, next) => {
  const requestId = request.get('x-request-id') || randomUUID();
  request.chimeRequestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/**
 * Per-address throttle on sign-in, sitting in front of the per-account lockout.
 * The lockout stops an attack on one account; this stops one address spraying
 * many accounts. In-process and therefore per-instance, which is the right
 * scope for a single-node deployment; a multi-node one needs a shared store.
 */
const signInAttempts = new Map<string, { count: number; resetAt: number }>();
const SIGN_IN_WINDOW_MS = 60_000;
const SIGN_IN_MAX_PER_WINDOW = 10;

const signInThrottle: RequestHandler = (request, response, next) => {
  if (request.method !== 'POST' || !request.path.startsWith('/session')) {
    next();
    return;
  }
  const key = request.ip ?? 'unknown';
  const now = Date.now();
  const entry = signInAttempts.get(key);

  if (!entry || entry.resetAt <= now) {
    signInAttempts.set(key, { count: 1, resetAt: now + SIGN_IN_WINDOW_MS });
  } else if (entry.count >= SIGN_IN_MAX_PER_WINDOW) {
    response.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    response.status(429).json({
      error: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many sign-in attempts from this address. Wait a minute and try again.',
      },
    });
    return;
  } else {
    entry.count += 1;
  }

  // Bound the map so a long-running process cannot accumulate addresses.
  if (signInAttempts.size > 5_000) {
    for (const [address, value] of signInAttempts) {
      if (value.resetAt <= now) signInAttempts.delete(address);
    }
  }
  next();
};

/*
 * `ok` is about this service; `degraded` is about the system.
 *
 * They are kept apart because they have different audiences. A load balancer
 * reads the status code and should only ever remove an instance that genuinely
 * cannot answer. A person reads `degraded`, which is where a stopped
 * notification worker shows up — the studio works perfectly while reminders
 * quietly go unsent, so it needs somewhere to be seen.
 */
app.get('/api/chime/admin/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    const worker = await readWorkerStatus(pool, 'notifications').catch(() => null);
    const degraded = worker !== null && !worker.running;
    response.json({
      ok: true,
      service: 'chime-admin-api',
      degraded,
      ...(degraded ? { attention: ['Notifications are not being sent.'] } : {}),
      notificationWorker: worker,
    });
  } catch (error) {
    next(error);
  }
});

// Sign-in is how a session is obtained, so it cannot sit behind the middleware
// that requires one. It carries its own throttle instead.
app.use('/api/chime/admin', signInThrottle, createSessionRouter(pool));

app.use('/api/chime/admin', requireAdminSession(pool), createAdminRouter(pool));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AdminApiError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  // Body-size rejections happen in body-parser before any route runs, so they
  // surfaced as a bare INTERNAL_ERROR. An administrator importing a newsletter
  // needs to know it was too big, not that something unspecified went wrong.
  if (typeof error === 'object' && error && 'type' in error
      && (error as { type: unknown }).type === 'entity.too.large') {
    response.status(413).json({
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'That content is larger than Chime accepts in one request (96 KB). '
          + 'Host large images and link to them instead of embedding them.',
      },
    });
    return;
  }

  const databaseCode = typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (databaseCode === '23505') {
    response.status(409).json({ error: { code: 'DUPLICATE_SERVICE', message: 'A service with this slug or idempotency key already exists.' } });
    return;
  }
  if (databaseCode === '23503' || databaseCode === '22P02') {
    response.status(400).json({ error: { code: 'INVALID_RELATIONSHIP', message: 'A location, staff member, or resource does not belong to this organization.' } });
    return;
  }

  console.error('Chime admin API error', error);
  reportError(error, { service: 'chime-admin-api' });
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The administrator request could not be completed.' } });
};
app.use(errorHandler);

/*
 * Loopback by default, because on a workstation this API should not be
 * reachable from the network. In a container the boundary is the container
 * itself and the process has to accept connections from the proxy in front of
 * it, so the address is configurable — but it stays loopback unless something
 * deliberately says otherwise.
 */
const host = process.env.CHIME_ADMIN_BIND_HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`Chime admin API listening on http://${host}:${port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; closing Chime admin API.`);
  server.close(async () => {
    // Queued reports go before the process does, or the fault that prompted the
    // restart is the one report that never arrives.
    await flushErrorReports();
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
