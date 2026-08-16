# Chime Admin Backend

This backend is a separate Chime-owned administrator API. It does not import, query, deploy, or modify CheckInn, and it does not replace the protected customer booking API.

## What this slice provides

- Signed, short-lived administrator sessions.
- Database membership checks on every authenticated request.
- Organization-scoped service reads and writes.
- Owner, admin, and manager write permissions.
- Optimistic concurrency through `If-Match` service versions.
- Idempotency requirements for every mutation.
- Audit history and transactional outbox events in the same database transaction.
- Demo-mode fallback when the frontend API URL or token is absent.

## Local database setup

Use the existing Chime Postgres service, then apply the additive platform migration and local seed:

```bash
psql "$CHIME_DATABASE_URL" -f database/migrations/001-platform-foundation.sql
psql "$CHIME_DATABASE_URL" -f database/seed-admin-demo.sql
```

Neither SQL file touches CheckInn or the old public demo tables.

## Configure the administrator API

Create a private `server/.env` from `server/.env.admin.example`. Replace the example session secret with at least 32 random characters.

Install and start the isolated administrator API:

```bash
cd server
npm ci
npx tsx src/admin/index.ts
```

The default API address is `http://127.0.0.1:8888/api/chime/admin`.

## Generate a local administrator session

With the same private `server/.env` loaded:

```bash
cd server
npx tsx src/admin/create-session.ts
```

The command prints a short-lived signed token. It does not create a password or store the token in the database.

## Connect Services Studio

Create a private root `.env.local` using `.env.admin.example`, then place the generated token in `VITE_CHIME_ADMIN_TOKEN`.

Start the admin frontend with its dedicated configuration:

```bash
npx vite --config vite.admin.config.ts
```

When both frontend variables are present, Services Studio loads from Postgres and `Save service` performs durable writes. Without both variables it remains in clearly labeled session-only demo mode.

## API surface

- `GET /api/chime/admin/health`
- `GET /api/chime/admin/me`
- `GET /api/chime/admin/services`
- `GET /api/chime/admin/services/:serviceId`
- `POST /api/chime/admin/services`
- `PUT /api/chime/admin/services/:serviceId`
- `DELETE /api/chime/admin/services/:serviceId` archives rather than hard-deletes

All service IDs, location IDs, staff IDs, and resource IDs are Chime UUIDs scoped to the signed organization.

## Production boundary

The included token generator is for local development. Production should exchange an external identity-provider session for a short-lived Chime administrator session, keep the signing secret outside the frontend, require HTTPS, and use a production Postgres connection through the chosen Cloudflare deployment path.

## Connected directory and smoke test

The admin API now exposes tenant-scoped GET /staff and GET /locations routes beside the service routes. Services Studio replaces its sample staff IDs with these records and exposes location assignment when an authenticated API configuration is present. Legacy non-UUID sample relationship IDs are removed before durable service writes.

For local verification, initialize PostgreSQL with the platform migration, seed-admin-demo.sql, and seed-admin-test.sql; start npm run dev:admin in server/; generate owner and viewer sessions with npm run session:admin; then run npm run test:admin-api at the project root with CHIME_ADMIN_OWNER_TOKEN and CHIME_ADMIN_VIEWER_TOKEN set.

## Connected directory and smoke test

The admin API now exposes tenant-scoped GET /staff and GET /locations routes beside the service routes. Services Studio replaces its sample staff IDs with these records and exposes location assignment when an authenticated API configuration is present. Legacy non-UUID sample relationship IDs are removed before durable service writes.

For local verification, initialize PostgreSQL with the platform migration, seed-admin-demo.sql, and seed-admin-test.sql; start npm run dev:admin in server/; generate owner and viewer sessions with npm run session:admin; then run npm run test:admin-api at the project root with CHIME_ADMIN_OWNER_TOKEN and CHIME_ADMIN_VIEWER_TOKEN set.
