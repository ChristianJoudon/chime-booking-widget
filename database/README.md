# Chime database

## Applying migrations

`npm run migrate` applies everything not yet recorded, to an existing database.

This is the only way to update a database that already has data. `docker-compose`
mounts SQL into `/docker-entrypoint-initdb.d`, which Postgres runs **only when
the data directory is empty** — an existing volume never receives a new
migration. Migrations 014 and 015 had to be applied by hand before this existed.

```bash
npm run migrate           # apply pending
npm run migrate:status    # what is applied, pending, or edited since it ran
```

`public.chime_schema_migrations` records each filename with a sha256 of its
contents. If an already-applied migration is edited, both commands refuse to
proceed and say so: two databases would otherwise silently disagree. Add a new
migration instead of editing an applied one.

A database created before the ledger existed is detected and recorded as
already-applied rather than re-run.

## Ordering, and why docker-compose still enumerates files

`database/postgres-schema.sql` is a prerequisite, not a migration: it creates
the `public.chime_*` tables the booking widget uses, and migration 002 adds
constraints to them. The runner applies it first and records it as
`000-postgres-schema.sql`.

**Seeds are interleaved with migrations on first boot, and that is load-bearing.**
Migrations 007, 008, 011, 012 and 013 seed organization-scoped rows with
`SELECT ... FROM chime_app.organizations`, so they insert nothing unless an
organization already exists. `docker-compose.yml` therefore runs
`seed-admin-demo.sql` between migrations 001 and 002. Running every migration
and then every seed produces a database with **no notification templates** —
confirmed by doing it.

That interleaving is why the mount list is still explicit rather than a glob.

### Known consequence

Because those five migrations seed from existing organizations, an organization
created *later* receives none of those defaults. `launch_settings` is covered at
runtime by `ensureLaunchSettings`, but notification templates are not: a second
business onboarded today would have zero templates. Provisioning a new
organization should seed these, rather than a migration doing it once.

## Local database

`docker compose up -d` starts Postgres on host port **5534** with the schema and
demo seed applied on first boot. `docker compose down -v` wipes the volume and
reseeds from scratch.

```bash
export DATABASE_URL=postgres://chime:chime@localhost:5534/chime
```
