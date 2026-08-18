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

## Payments confirmed by Stripe, not by the browser

`POST /api/chime/stripe/webhook` is the server's own account of what happened to
a payment. Until it is configured, the only thing telling this system a card
succeeded is the customer's browser, which is the least trustworthy party in the
transaction and the one most likely to close the tab halfway through.

Point a Stripe endpoint at `https://your-host/api/chime/stripe/webhook`,
subscribe it to `payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled` and `charge.refunded`, and put the signing secret in
`STRIPE_WEBHOOK_SECRET`. Without that variable the endpoint answers 503 rather
than accepting unverified events.

Three things worth knowing about how it behaves:

- **It is mounted before the JSON parser.** Stripe signs the exact bytes it
  sent, and a parser that has already consumed the stream leaves nothing to
  verify against. If the route is ever moved below `express.json`, every event
  will fail its signature and the reason will not be obvious.
- **Every event id is recorded before it is acted on.** Stripe retries, and
  retries arrive after restarts and at other containers, so remembering in
  process memory would not be remembering at all. A repeat is answered
  `{"received":true,"duplicate":true}` and changes nothing.
- **Money with no appointment is flagged, not fixed.** If Stripe reports a
  payment succeeded and there is no booking for it, the hold is marked with
  `needs_attention_reason` and left for a person. Creating the missing
  appointment automatically would mean inventing a time the customer never
  chose.

## Limits on the two endpoints that cost something

`POST /bookings` and `POST /create-payment-intent` allow twenty attempts per
address per ten minutes. Reads are deliberately unlimited — a customer
refreshing available times should never be told to slow down, and the widget
polls them.

The count is per address, which depends on `trust proxy` being set. Behind a
load balancer without it, every request appears to come from the balancer and
one busy customer locks out everyone.

## Knowing the notification worker is alive

The worker has no port and no request log, so when it stops, nothing visible
changes: the API still answers, the studio still loads, and reminders simply
stop being sent. The first person to notice is a customer who did not get one.

It now writes to `chime_app.worker_heartbeats` at the end of every cycle — the
end, so that a cycle wedged on a query that never returns stops the beat too.
A process that is running but stuck is exactly the case a liveness check misses.

Three places show it:

```bash
curl -s https://your-host/api/chime/admin/health | jq '{degraded, notificationWorker}'
```

- `GET /api/chime/admin/health` reports `degraded: true` and says notifications
  are not being sent. The status code stays 200, because the admin API is fine.
- `GET /api/chime/health` reports the worker but never changes its own status
  code for it. Pulling an instance out of rotation because reminders are stuck
  would turn a delayed message into an outage.
- The worker's own port answers 503 when its beat is late, and
  `docker-compose.prod.yml` health-checks it, so a wedged worker is restarted.

A beat is late after four intervals plus thirty seconds — about fifty seconds at
the default poll. Generous on purpose: nobody acts on a notification worker
being ten seconds behind, and false alarms are how monitoring gets ignored.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request: types, lint and all four
builds in one job, and the full integration suite against a real Postgres in
another.

Most of it lives in `scripts/ci-integration.mjs` rather than in the workflow
file, because a workflow can only be exercised by pushing a branch and waiting,
while a script can be run before anyone depends on it. Run the same thing here:

```bash
npm run ci:integration
```

It migrates, seeds, starts both APIs, the worker and the studio, mints an owner
and a viewer session, runs all eleven suites, and shuts down. The browser suites
are skipped — loudly, and listed as skipped — when no Chrome is found, so a
smaller green never reads as a full one.

## Bookings taken over the phone

**Appointments → Schedule → Add appointment.** For a booking agreed on the
phone or at the counter: service, team member, when, and who it is for. It goes
into the schedule immediately and stops that time being offered on your booking
page.

Three things it does that are easy to miss:

- **It refuses a double booking.** The same check the reschedule flow uses,
  including each service's before and after buffers — so a ninety-minute
  appointment with a fifteen-minute buffer blocks the two hours it really
  occupies, not just the ninety minutes.
- **It links to a customer you already have** when the phone number or email
  matches one, rather than making a second record. Matched on contact details,
  never on name: two people can share a name, and merging strangers is worse
  than a duplicate.
- **Nobody is emailed or texted.** You have just spoken to them, and a
  confirmation sent to an address typed from memory is as likely to reach a
  stranger as the customer.

A service hidden from customers can still be booked here. Hidden means "not
offered on the website", not "retired", and the people already asking for it
still have to be written down.

### The bridge this closed

The widget's availability was already aware of who is busy — it counts the team
members who could take a slot and are free, and marks it booked when none are.
What it counted as "busy" was only ever a record left behind by a widget
booking.

Nothing a customer could do reached that gap, because until now nothing but the
widget could create an appointment. Entering one by hand would have walked
straight into it: booked solid in the studio, still bookable on the website.
Migration 022 teaches that one query about appointments as well, so both sides
now answer the same question the same way, and `npm run test:contracts` checks
it in both directions — a booking takes the time, and removing it gives it back.

## Finding out when something breaks

Put a Sentry DSN in `CHIME_SENTRY_DSN` and both APIs and the worker start
reporting faults. Leave it empty and nothing happens at all — no SDK starts, no
network calls, no behaviour change. That is the default, and it is a supported
way to run: a business on one box with no error service should not pay for
wiring it does not use.

```bash
npm run test:observability --prefix server
```

**Customer details never leave the building.** This is a booking system, so a
request body is somebody's name, email, phone and the hour they will be alone in
a building; on the administrator side it is that plus notes a business wrote
about them. An error report carrying those is a data breach with a stack trace
attached, and it is the *default* behaviour of the SDK underneath.

So before anything is sent:

- **the body is dropped whole**, not filtered. A filter is a list of the fields
  somebody thought of, and the next field added to a form is not on it
- **the query string goes**, because the customer-approval links carry tokens in
  it, and the URL is truncated at the `?`
- **cookies go**, and every header except `accept`, `accept-encoding`,
  `content-type`, `content-length`, `user-agent`, `origin` and `referer`
- **a user is an id**, never an email or a name
- **performance tracing is off**, because sampling request URLs and timings for
  every customer collects a lot about people to answer a question nobody asked

What survives is the path, the method, the status and the stack — which is what
tells you which code broke. If a particular value is needed to understand a
fault, attach it at the call site on purpose.

The smoke test above hands the real scrub a report shaped like a real booking
and fails if any of a customer's name, email, phone, payment intent, session
token or approval token survives it.

### Two things that came with it

Both APIs now **shut down on a signal**. The customer API had no handler at all,
so a redeploy sent SIGTERM, nothing answered, and the runtime killed it ten
seconds later — cutting off whatever booking was in flight. They now close the
listener, flush any queued report and exit.

All three services **catch unhandled rejections and uncaught exceptions**, which
nothing did before. They are logged whether or not reporting is on, because a
crash reason in the container log still beats a silent restart. An uncaught
exception deliberately does *not* exit the process: Express has already answered
the request in flight, and a booking API that kills itself over one bad code
path turns a single failed request into an outage for everyone mid-booking. The
health check decides when a process is beyond help.

### What this does not cover

The **customer widget** is not reporting. It runs on other people's websites, so
turning it on means shipping a reporting SDK to every host site that embeds the
booking page — a size and privacy decision for those site owners as much as for
you, and one worth making deliberately rather than as a side effect. The
administrator studio is a separate question and also not wired yet; say the word
and either can be.
