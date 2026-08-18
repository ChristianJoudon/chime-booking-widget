# Deploying Chime

What this covers: getting the product onto a server, with backups, and taking a
first real booking safely. What it cannot cover: your hosting account, your
domain, and your Stripe and Resend credentials.

Nothing here has ever taken a real payment or sent a real email. The steps are
ordered so the first time either happens, it happens deliberately and to you.

## What runs

One image, three processes, built from the same compiled server so they cannot
drift apart:

| process | command | what it does |
|---|---|---|
| customer API | `node server/dist/index.js` | the booking widget talks to this |
| administrator API | `node server/dist/admin/index.js` | the studio talks to this |
| notification worker | `node server/dist/notifications/worker.js` | sends confirmations and reminders |

Plus Postgres, and a migration step that runs to completion before any of them
start. `docker-compose.prod.yml` wires all five together.

Both APIs bind to `127.0.0.1` on the host. **Put a reverse proxy terminating
TLS in front of them.** Neither should be reachable from the internet directly:
the administrator API in particular has no business being addressable.

## First deployment

```bash
cp .env.production.example .env.production   # then fill it in
openssl rand -hex 32                          # CHIME_ADMIN_SESSION_SECRET
openssl rand -base64 32                       # POSTGRES_PASSWORD

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
npm run preflight                             # refuses to pass on an incoherent setup
npm run provision -- --name "Your Business" --email you@example.com
```

`preflight` is not a formality. It fails a workspace that calls itself live
while still accepting demo payments, one holding a Stripe *test* key — where
deposits appear to be collected and no card is ever charged — and one that would
confirm nothing to customers because messages are still sandboxed.

## Going live, in the order that keeps it safe

The workspace starts in `demo`. Move it one step at a time and stop at each.

**1. Stripe in test mode.** Set `STRIPE_SECRET_KEY` to your `sk_test_…` key and
`CHIME_ALLOW_DEMO_PAYMENTS=false`, leave `CHIME_WORKSPACE_ENV=test`. Book an
appointment through the widget with Stripe's test card, capture the deposit,
then refund it. You are checking that money moves through the ledger and the
studio agrees with Stripe's dashboard.

**2. Real messages, still test money.** Set `CHIME_NOTIFICATION_MODE=live` and
your `RESEND_API_KEY`. Use the studio's **Send test to myself** on a template
before activating it. Book again and confirm the email actually arrives.

**3. Live money.** Set `CHIME_WORKSPACE_ENV=live` and the `sk_live_…` key. Run
`npm run preflight` again — it will refuse if anything above was left behind.
Book a real appointment on a card you own, for the smallest deposit you offer,
then refund it. That is your first real transaction, and you should be the
customer for it.

Only then point customers at the widget.

## Backups

```bash
npm run backup     # writes to ./backups, keeps the newest 14
```

Every dump is read back with `pg_restore --list` before the command reports
success, so a truncated or corrupt file fails immediately rather than on the day
you need it. Run it from cron, hourly to start:

```
0 * * * * cd /srv/chime && npm run backup >> /var/log/chime-backup.log 2>&1
```

Backups land on the host, not inside the database container's volume — deleting
the container cannot take them with it. **Copy them somewhere else as well.** A
backup on the same machine as the database is not a backup.

Restoring:

```bash
pg_restore --clean --if-exists --dbname "$CHIME_DATABASE_URL" backups/chime-….dump
```

Practise this once, on a throwaway database, before you need it.

## Adding another business

```bash
npm run provision -- --name "Second Business" --email owner@second.example
```

Creates the organization, the owner, the membership and the password in one
transaction, and a database trigger gives the new business its notification
templates and settings. It verifies the templates exist before committing,
because a business that can sign in but cannot send a confirmation would not
find that out until its first booking.

There is no self-serve signup. Businesses are onboarded with this command.

## Checks worth running against the deployment

```bash
npm run preflight               # configuration coherence
npm run test:contracts          # the studio and the widget agree
npm run test:booking-projection # a widget booking becomes an appointment
npm run test:accessibility      # the studio, across every screen
npm run test:embed-host-styles  # the widget, against hostile host CSS
```

The last two need Chrome on the machine running them, and are better suited to
a build pipeline than a production box.

## Still missing

- **No error tracking or uptime monitoring.** You will learn about failures from
  customers until something is added.
- **No CI.** Nothing runs these checks automatically on a change.
- **The session token is readable by JavaScript** in the studio. Acceptable for
  a small number of trusted operators; revisit before a wider rollout.
- **No rate limiting** beyond the sign-in throttle.
