# Chime database setup

Use `postgres-schema.sql` with PostgreSQL, Supabase, Neon, Railway Postgres, or another managed Postgres host. It creates real tables for services, availability slots, customers, bookings, calendar events, terms acceptances, and refundable deposits.

Suggested setup for local development is the Docker compose file at the project root. It starts Postgres with the connection string `postgres://chime:chime@localhost:5534/chime` and auto-applies `postgres-schema.sql` and `seed-demo.sql` on the FIRST boot (run `docker compose down -v` to wipe the data volume and reseed):

```bash
docker compose up -d
export DATABASE_URL=postgres://chime:chime@localhost:5534/chime
```

For a hosted Postgres, apply the files manually:

```bash
psql "$DATABASE_URL" -f database/postgres-schema.sql
psql "$DATABASE_URL" -f database/seed-demo.sql
```

The frontend never writes directly to the database. It calls API endpoints. Use the example Express server in `server/` or map the same route behavior into your existing website backend.

`seed-demo.sql` generates sample services and 180 days of real availability slots. Set `CHIME_TIME_ZONE` on the API server to keep returned date keys and time labels aligned with your business calendar.
