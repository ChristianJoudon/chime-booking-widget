import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import express, { type ErrorRequestHandler } from 'express';
import { Pool } from 'pg';

import { requireAdminSession } from './auth.js';
import { createAdminRouter } from './routes.js';
import { AdminApiError } from './types.js';

const port = Number(process.env.CHIME_ADMIN_PORT ?? 8788);
const connectionString = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('CHIME_DATABASE_URL or DATABASE_URL is required.');
}

const allowedOrigins = new Set(
  (process.env.CHIME_ADMIN_ALLOWED_ORIGINS
    ?? 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174')
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

app.get('/api/chime/admin/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, service: 'chime-admin-api' });
  } catch (error) {
    next(error);
  }
});

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
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The administrator request could not be completed.' } });
};
app.use(errorHandler);

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Chime admin API listening on http://127.0.0.1:${port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; closing Chime admin API.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
