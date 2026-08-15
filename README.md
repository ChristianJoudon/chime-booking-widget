# Chime Booking Widget

Chime is a Vite + React booking widget with a polished step-by-step appointment flow. Customers choose a service, move to a full interactive calendar, enter details, read the terms document to the bottom, optionally authorize a Stripe deposit, and submit the booking to your website API.

## What changed in this build

- Service selection and calendar selection are now separate screens.
- The visual system was rebuilt around a unified mint/sage liquid-glass interface with hover, tap, focus, and loading states.
- The blue calendar controls were removed. Calendar navigation now uses the Chime mint palette.
- The terms document is now an actual scroll-gated booking step. The acceptance checkbox and confirm action remain locked until the customer reaches the bottom.
- The demo calendar now covers 90 days, and the database seed can generate 180 days of real slots.
- A real Postgres schema and database-backed API example are included in `database/` and `server/`, including calendar events, terms acceptances, and double-booking protection.

## Quick start

```bash
npm install
npm run dev
```

Local development uses demo services and demo availability by default. To force real API data locally, copy `.env.example` to `.env.local` and set `VITE_CHIME_USE_DEMO_DATA=false`.

## Production build

```bash
npm run build
npm run preview
```

Use production environment variables in your hosting platform instead of committing `.env.local`.

## Real database option

The fastest path is Docker. The compose file starts Postgres and auto-applies the schema and demo seed on the first boot:

```bash
docker compose up -d
cd server && cp .env.example .env   # set DATABASE_URL=postgres://chime:chime@localhost:5434/chime
npm install && npm run dev          # API on http://localhost:8787
# in another terminal, project root:
cp .env.example .env.local            # then set VITE_CHIME_USE_DEMO_DATA=false (API URLs are already in the example)
npm run dev                          # widget now uses the real DB via the Vite proxy
```

The Vite dev server proxies `/api` to `http://localhost:8787`, so no `VITE_CHIME_API_BASE_URL` is needed locally. To wipe the database and reseed, run `docker compose down -v` and start again.

### Hosted Postgres (Neon, Supabase, Railway)

Apply the schema and seed manually with `psql`, then run the example API server against your hosted `DATABASE_URL`:

```bash
psql "$DATABASE_URL" -f database/postgres-schema.sql
psql "$DATABASE_URL" -f database/seed-demo.sql

cd server
npm install
cp .env.example .env
npm run dev
```

Then point the widget to the server routes with the `VITE_CHIME_*` variables in `WIDGET_INTEGRATION.md`. Set `CHIME_TIME_ZONE` in `server/.env` to the business timezone used for calendar dates and labels.

## Data options

You can provide data in either of these ways:

1. Add `window.CHIME_WIDGET_CONFIG` before the widget script loads.
2. Configure API endpoints with the `VITE_CHIME_*` environment variables or with `window.CHIME_WIDGET_CONFIG.api`.

See [`WIDGET_INTEGRATION.md`](./WIDGET_INTEGRATION.md) for the expected config shape and API request/response payloads.

## Useful scripts

```bash
npm run dev        # start Vite locally
npm run build      # production build
npm run preview    # preview the production build
npm run typecheck  # TypeScript check
npm run lint       # ESLint check
npm run css:check  # Tailwind compile check
```

## Current source layout

```text
src/
  App.tsx                       # step-by-step shell and data loading
  components/booking/           # details, terms, payment, done screen
  components/calendar/          # custom full calendar and time picker
  components/layout/Header.tsx
  components/services/ServiceList.tsx
  components/ui/                # shared buttons and progress indicator
  data/                         # demo data only
  lib/                          # API, date, config, normalizer helpers
  types/                        # shared TypeScript types

database/                       # Postgres schema and seed data
server/                         # Express + Postgres API example
```


## Current booking flow

The front-end flow is now:

1. Choose a service.
2. Pick a calendar date and appointment time.
3. Read the Terms & Conditions. The acceptance checkbox is locked until the customer scrolls to the bottom.
4. Enter contact details. Full name and email are required and marked with red asterisks.
5. Pay the refundable $20.00 appointment deposit.
6. Receive the confirmation page.

The styling has been softened back toward the first iteration: pastel mint, playful rounded cards, lighter shadows, and simple white panels while retaining the newer interaction behavior and database/API scaffolding.
