# Chime Postgres API example

This is a real database-backed API example for the widget. It expects the SQL schema in `../database/postgres-schema.sql`.

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Then point the widget to:

```env
VITE_CHIME_API_BASE_URL=http://localhost:8887
VITE_CHIME_SERVICES_URL=/api/chime/services
VITE_CHIME_AVAILABILITY_URL=/api/chime/availability
VITE_CHIME_BOOKING_URL=/api/chime/bookings
VITE_CHIME_PAYMENT_INTENT_URL=/api/chime/create-payment-intent
```

The booking route uses a database transaction and row lock so two customers cannot confirm the same slot at the same time.

Set `CHIME_TIME_ZONE` in `.env` so returned date keys and time labels match the business calendar timezone. The server also exposes `GET /api/chime/calendar-events` for an admin calendar view.
