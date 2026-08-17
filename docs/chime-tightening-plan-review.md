# Review: Chime Product Tightening Plan

Reviewed against the running system on 2026-08-16 — live Postgres, live admin API, and the
served admin build. Every claim below was verified by query or HTTP request, not read off the
source alone.

> **Status: Phase 0 completed 2026-08-16.** The items marked **[FIXED]** below have been
> resolved and verified. See [Phase 0 completion](#phase-0-completion-2026-08-16) at the end
> for exactly what changed and how each fix was checked.
>
> **Ports in the sections below describe the system as reviewed, before it was moved onto a
> dedicated block.** For current ports and the widget/standalone file boundary, use
> [`ISOLATION.md`](../ISOLATION.md), which is the authority.
>
> **Phase 1 ("Trust the Data") completed 2026-08-16.** See
> [Phase 1 completion](#phase-1-completion-2026-08-16) at the end.

## Bottom line

**The backend is real and substantially built.** It is not a front-end mock.

- Postgres `chime-standalone-db` is running on port 5434 (healthy, up 38 hours).
- Schema `chime_app` holds **40 tables**. Migrations 001–013 are all applied.
- The admin API is live on port 8788 — 11 route modules, ~9,300 lines of server TypeScript.
- The customer booking API is live on port 8787, with Stripe and a real
  payment-verified-before-persistence guard.
- The admin UI being served on port 4174 **is connected to that backend** and holds a valid
  owner session.

Populated data: 1 organization, 4 real services, 3 staff, 2 locations, 10 appointments,
6 customers, 15 availability rules, 11 notification templates, 8 queued deliveries,
31 audit events, 30 outbox events, 9,400 availability slots.

**What is actually missing is not the backend. It is reproducibility.** None of the
configuration that makes the running system work exists in the repository. There is no `.env`,
no `.env.local`, and no `server/.env`. The API being served is a bundle in `/tmp`. A fresh
clone, or a `docker compose down -v`, produces a system that does not run. That gap is what
makes the project *feel* front-end-only, and the plan does not mention it anywhere.

---

## The one hard bug: Launch is broken by a SQL type error **[FIXED]**

The plan's Finding #3 says *"Launch currently reports a generic failure instead of telling the
administrator what is incomplete,"* and prescribes rebuilding Launch as a readiness checklist.

**The checklist already exists.** `launchReadiness()` in
[launchRoutes.ts:112-156](../server/src/admin/launchRoutes.ts#L112) implements four checks —
services, team, booking hours, widget design — each with plain-language remediation copy. It is
simply unreachable.

Root cause, at [launchRoutes.ts:98-103](../server/src/admin/launchRoutes.ts#L98):

```sql
INSERT INTO chime_app.launch_settings (organization_id, public_business_id)
VALUES ($1, 'biz_' || replace($1::text, '-', ''))
ON CONFLICT (organization_id) DO NOTHING
```

Postgres infers `$1` as `uuid` from the column context and as `text` from the cast, then fails:

```
error: inconsistent types deduced for parameter $1
detail: 'text versus uuid'
code:   42P08   (routine: variable_coerce_param_hook)
```

Every `GET /launch` and `PUT /launch` returns 500 `INTERNAL_ERROR` — which surfaces to the
administrator as the generic string at
[admin/index.ts:90](../server/src/admin/index.ts#L90): *"The administrator request could not be
completed."* That is precisely the message the plan is reacting to.

The fix is one line:

```sql
VALUES ($1::uuid, 'biz_' || replace($1::uuid::text, '-', ''))
```

**This changes the priority of plan section #3 completely.** It is not a design project. It is
a typo, and the feature behind it is already written.

Caveat after the fix: `widget_configs` currently has **0 rows**, so the `widget` readiness check
still fails and publishing stays blocked. Either save a design once in Widget Designer, or treat
the served default config as satisfying the check.

---

## Plan findings verified against the code

| # | Plan finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Establish one source of truth | **Right symptom, wrong diagnosis** | Cause is config resolution, not data divergence — see below |
| 2 | Separate demo/test/live | **Confirmed** | 6 `Smoke service <ts> updated` rows in `chime_app.services`; customers with `payment-safety-…@example.invalid` and `metadata.demoProfile: true` |
| 3 | Launch preflight | **Confirmed symptom, root cause found** | SQL 42P08, above. Checklist code already exists |
| 4 | Simplify navigation | **Confirmed** | `NAV_ITEMS` at [AdminApp.tsx:143](../src/admin/AdminApp.tsx#L143) has 11 entries + Settings |
| 5 | Tighten Services Studio | **Confirmed** | 6 of 10 service rows are smoke-test drafts (`is_active = false` but still listed) |
| 6 | Predictable actions | **Partly already done** | `If-Match` version checks and `Idempotency-Key` are enforced across service, launch, customer, and operations mutations; audit + outbox writes are transactional |
| 7 | Simplify Messages | **Confirmed** | 5 of 11 `notification_templates` contain literal two-character `\n` sequences, not newlines |
| 8 | Schedule safety | Not separately verified | Depends on `OperationsStudio`, which does load real data |
| 9 | Customers focus | **Already largely built** | `/customers` returns tags, appointment counts, lifecycle status, consent flags, notes |
| 10 | Payment/delivery reliability | **Guardrail honored** | Payment is re-verified before any booking write — [index.ts:340-380](../server/src/index.ts#L340) — before the insert at [index.ts:430](../server/src/index.ts#L430) |
| 11 | Literal language | Style call, no code impact | — |

### Why Finding #1 needs restating

The plan reads the inconsistency as *workspaces disagreeing about shared data*. The mechanism is
narrower and more fixable: **`api.configured` is a hard gate, and when it is false each studio
silently renders sample data.**

```ts
// adminApi.ts:676
this.configured = Boolean(this.baseUrl && this.token);
```

When false, `AdminApp` renders an entirely separate hardcoded calendar
([AdminApp.tsx:623-630](../src/admin/AdminApp.tsx#L623)) instead of `OperationsStudio`, and
services come from `INITIAL_ADMIN_SERVICES`. Every studio has the same `if (!api.configured)`
branch. So "the workspaces disagree" is more accurately "half the app is a mock, and which half
you get depends on an environment variable."

Compounding it, **three different environment-variable naming schemes** resolve the same
connection:

| Location | Variables read |
|---|---|
| [adminApi.ts:932](../src/admin/adminApi.ts#L932) | `VITE_CHIME_ADMIN_API_URL`, `VITE_CHIME_ADMIN_TOKEN` |
| [OperationsStudio.tsx:121](../src/admin/OperationsStudio.tsx#L121) | same names, but defaults the URL to `http://127.0.0.1:8788/api/chime/admin` and the token to `''` |
| [serviceStudioDirectory.tsx:72-80](../src/admin/serviceStudioDirectory.tsx#L72) | `VITE_CHIME_ADMIN_API_BASE_URL`, `VITE_CHIME_ADMIN_API_URL`, `VITE_CHIME_ADMIN_ACCESS_TOKEN`, `VITE_CHIME_ADMIN_SESSION_TOKEN` |

`.env.admin.example` documents only the first pair. A single resolver would deliver most of
Finding #1 on its own.

---

## What the plan misses

These are not in the plan and several outrank items currently scheduled for Phase 2 and 3.

### 1. `docker-compose.yml` only mounts migrations 001–008 — *highest risk* **[FIXED]**

Migrations 009–013 are not mounted: `payment_actions`, `business_settings`, `launch_settings`,
`embed_installations`, and the rich-template columns. `database/seeds/002-demo-schedule.sql` is
not mounted either.

The live database only has them because someone applied them by hand. **`docker compose down -v && docker compose up` yields a database the current code cannot run against.** This single gap is
the best explanation for the sense that the backend is not set up — for anyone starting fresh,
it genuinely is not.

### 2. A 7-day owner token is compiled into the served JavaScript bundle

`dist-admin/assets/admin.js` contains a valid signed session — `role: owner`,
`expiresAt: 2026-08-23` — baked in by Vite at build time and served by
`python -m http.server` on port 4174. Anyone who can fetch that file has full owner API access
for a week.

This is fine as a local development shortcut but must not survive contact with a real
deployment. The plan never mentions authentication at all, and there is no login — which is the
largest single gap between the current build and a product.

### 3. No migration runner, and no record of what is applied

There is no `schema_migrations` table. Ordering exists only as filename prefixes inside
`docker-compose.yml`. There is no way to ask the database what state it is in.

### 4. The running API is not the repository **[FIXED]**

The live process is `/tmp/chime-standalone-admin-live/admin-api.mjs` — a bundle in a temp
directory with its own `node_modules`, started with inline environment variables. macOS cleans
`/tmp`. Because `server/.env` does not exist, `npm run dev:admin` from the repo throws
immediately on the missing `CHIME_DATABASE_URL`. No committed script produces that bundle.

### 5. `npm run typecheck` fails in both packages **[FIXED]**

Root exits 2 with 9 errors; `server/` similar. **All are `TS2688`** from duplicated
`@types/<pkg> 2` directories — macOS copy artifacts from the Downloads folder
(`node 2`, `react 2`, `estree 2`, …). There are no real type errors, but every quality gate is
currently dead. Removing the ` 2` directories fixes it.

### 6. The widget → admin bridge has never actually run **[FIXED — now verified and covered by a smoke test]**

Migration 005 installs a genuinely well-designed projection: `AFTER INSERT ON
public.chime_bookings` calls `chime_app.project_widget_booking()`, which maps the public service
to the admin service via `admin_service_id`, links or creates the `chime_app` customer, and
writes an appointment plus an outbox event.

But `public.chime_bookings` = **0 rows** and `widget_booking_links` = **0 rows**. The entire
customer-booking-to-admin-schedule path is unexercised. The plan defers this to Phase 5
("verify payment and delivery failure paths"); it belongs in Phase 1, because one real booking
landing in the admin Schedule validates the whole architecture at once.

### 7. Legacy widget services own 79% of the slot table

`public.chime_services` still holds `consultation`, `repair`, and `installation` — text IDs, no
`admin_service_id`, `active = false` — and they own **7,440 of 9,400** availability slots. They
are correctly deactivated, so this is cleanup rather than a live bug, but a booking against any
of them would silently `RETURN NULL` from the projection and never reach the admin schedule.

### 8. No test runner **[PARTLY ADDRESSED]**

Six `.mjs` smoke scripts exist, each requiring manual environment setup and a live server. There
is no `npm test`. Plan Phase 5's "cross-workspace contract tests" has no foundation to build on.

### 9. Payments and Insights are structurally empty

`payments` = 0 and `payment_actions` = 0, so `/insights` returns `netCollectedMinor: 0`,
`completedRate: 0`, `cancelledRate: 0`. Not a defect, but neither workspace can currently
demonstrate its value, which will distort any review of them.

### 10. Nothing is committed

35 uncommitted paths, including 5 migrations, 4 new studios, and the tightening plan itself.

---

## Recommended resequencing

The plan's Phase 1 is correct in spirit but starts one step too late. It asks the workspaces to
agree before the system can be reliably started at all.

### Insert Phase 0 — make it run, reproducibly (roughly one day)

1. Fix the `$1` cast in `ensureLaunchSettings`. Unblocks all of plan section #3.
2. Mount migrations 009–013 and `database/seeds/` in `docker-compose.yml`; verify
   `down -v && up` produces a working database.
3. Commit `.env.local` / `server/.env` templates that actually work, and run the admin API from
   the repository rather than `/tmp`.
4. Delete the duplicated `@types/* 2` directories so `npm run typecheck` passes.
5. Drive one real widget booking end to end and confirm it appears in the admin Schedule,
   Customers, and Insights.
6. Commit the current work.

### Then Phase 1 as written, with two amendments

- Replace "unify organization data" with **"unify API configuration"** — one resolver, one pair
  of variable names, one `configured` signal. Most of the disagreement disappears with it.
- Delete the sample-data fallback branches outright rather than reconciling them. An
  authenticated screen that cannot reach the API should say so, per the plan's own three-state
  rule (loaded / empty / failed).

### Promote to Phase 1 from later phases

- Replace the build-time token with a real login before anything ships outside localhost.
- Add a migration runner and a `schema_migrations` table.

### Demote

- Plan section #3 (Launch) drops from a design project to a one-line fix plus a `widget_configs`
  seed.
- Plan section #6 (predictable actions) is already ~70% implemented — `If-Match`,
  `Idempotency-Key`, transactional audit and outbox writes are all in place. What remains is the
  UI preview layer, not the safety machinery.

## Where the plan is strongest

Sections #2 (demo/test/live separation), #7 (Messages split and the escaped-newline repair), and
the Product Guardrails are accurate, specific, and worth keeping verbatim. The payment guardrail
in particular is already honored in code and should stay stated so it is not regressed.

---

## Phase 0 completion (2026-08-16)

Everything in the Phase 0 list above has been done and verified.

### 1. Launch SQL parameter bug

`ensureLaunchSettings` now casts `$1` consistently
([launchRoutes.ts:98](../server/src/admin/launchRoutes.ts#L98)). The same
`$N::text`-with-dual-inference pattern was audited across the rest of the server; the other five
occurrences all use their parameter in a single type context and are safe.

`GET /launch` went from 500 to 200, returning the readiness checklist that already existed:

```
readiness: 3/4 complete (75%)  ready=false
  PASS  Public service   4 bookable services ready.
  PASS  Team coverage    3 active team members available.
  PASS  Booking hours    Working-hour rules are ready for customer booking.
  TODO  Widget design    Save the customer-facing design first.
```

The remaining item is genuine product state, not a defect — Launch will read 75% until a widget
design is saved once. Launch Studio renders end to end in the browser, including the hosted
booking link, all three embed snippets, and the domain allowlist.

### 2. Reproducible database

`docker-compose.yml` now mounts migrations 009–013 and the seed directory. Two seeds were added
because the existing one could not run on an empty database:

- `database/seeds/001-demo-customers.sql` — the six demo customers with fixed UUIDs.
  `002-demo-schedule.sql` references these IDs, and `chime_app.appointments` has a composite
  foreign key to `(organization_id, id)` on `chime_app.customers`, so without this the seed
  failed outright.
- `database/seeds/003-demo-availability.sql` — weekday 09:00–17:00 rules for the three demo
  staff. A fresh database previously had zero availability rules, which is exactly the
  "Availability reported no active team schedules" symptom in plan Finding #1.

Verified by booting a throwaway container against the same mount list (no published port, no
named volume, so the live database was never at risk). A fresh initialization now produces **40
tables — identical to the live database** — with a clean init log. Seeded row counts match live
across every table, except services, where fresh has the 4 real ones and none of the 6
smoke-test rows.

### 3. Running from the repository

`server/.env` and `.env.local` now exist, covering all 35 environment variables the server reads
(the two example files between them were missing five). Both are gitignored; `.env` was added to
`.gitignore` as well.

Both APIs were moved off their previous hosts and onto repo source:

| | before | after |
|---|---|---|
| admin API | bundle in `/tmp/chime-standalone-admin-live/` | `cd server && npm run dev:admin` |
| customer API | `server/dist/index.js` (compiled) | `cd server && npm run dev` |
| admin UI | `python -m http.server` over `dist-admin` | `npm run dev:admin` (Vite) |

`npm run session:admin` was confirmed to produce a token the running API accepts.

Note: the Vite dev server binds IPv6 only, so the admin URL is **`http://localhost:4374`** —
`127.0.0.1:4374` will not connect. Both origins are in `CHIME_ADMIN_ALLOWED_ORIGINS`.

This checkout was subsequently moved onto a dedicated port block — Postgres 5534, customer API
8887, admin API 8888, booking dev 5373, admin studio 4374, approval 4375 — so it cannot contend
with the other Chime copies on this machine. `ISOLATION.md` now carries the full identity, port,
and file-ownership contract, including which paths belong to the booking widget and must not be
changed by standalone work.

Moving the admin UI to the dev server also removes the immediate exposure from finding #2 above:
the token is no longer sitting in a static bundle on a served directory. The underlying issue —
that `npm run build:admin` inlines whatever token is in `.env.local` — is unchanged, and
`config/admin/.env.local` now carries a warning about it. Replacing the build-time token with a real login is
still the top Phase 1 item.

### 4. Typecheck

The 21 empty `@types/<pkg> 2` directories (macOS copy artifacts) were removed. That exposed 5
real errors underneath. Four were fixed:

- three `replaceAll` calls failing under `lib: ES2020` — `tsconfig.json` raised to `ES2021`,
  matching code already written against it. This is typecheck-only: `noEmit` is set, and Vite
  transpiles with its own esbuild target, so no build output changes
- one implicit `any` that resolved with the lib change

**One is deliberately left unfixed.** `src/embed.tsx:59` reports an `Element` vs `HTMLElement`
variance error, because `autoMount` now calls `mountConfiguredElement`, whose `MountWidget` type
accepts `Element` while `mount` accepts `HTMLElement`. That call is in-progress booking-widget
work, and the widget is maintained separately from Chime Standalone — see
[Isolation](#isolation-standalone-must-not-touch-the-booking-widget) below. Resolving it is a
widget decision.

`server/` typecheck exits 0. Root typecheck reports that single widget error and nothing else.
`npm run lint` exits 0 (2 pre-existing `exhaustive-deps` warnings).

### 5. Widget → admin projection, proven and now covered

One real booking was driven through the customer API against a deposit-bearing service, and the
migration-005 trigger chain was confirmed at every hop: `public.chime_bookings` →
`widget_booking_links` → `chime_app.appointments` (`CH-EBF7E949`, source `widget`, status
`pending_approval`) → auto-created admin customer → `chime_app.payments` (2500¢, succeeded) →
auto-assigned staff → `outbox_events` → queued notification → **visible in the admin UI's
activity feed**. The payment guardrail held: the same booking without a payment intent was
refused with 402 and wrote no rows.

This is now repeatable rather than a one-off. `scripts/booking-projection-smoke.mjs`
(`npm run test:booking-projection`) asserts 11 checks across that chain and tears down
everything it creates — deleting the widget booking exercises the removal trigger, so teardown
doubles as a check that unwinding works. It was run twice in a row to confirm idempotency, and
the database is back at its exact baseline (10 appointments, 6 customers, 0 payments, 0 widget
bookings).

### Also fixed along the way

`serviceStudioDirectory.tsx` never read `VITE_CHIME_ADMIN_TOKEN` — only
`VITE_CHIME_ADMIN_ACCESS_TOKEN` and `VITE_CHIME_ADMIN_SESSION_TOKEN`, neither of which is
documented anywhere. With a correctly configured workspace it therefore fell through to demo
staff and **zero locations**, which is precisely the "Team reported zero covered locations while
scheduled appointments used locations" symptom in plan Finding #1. All three env-var schemes now
resolve from the two documented variables.

## Isolation: standalone must not touch the booking widget

`ISOLATION.md` states that this folder is an independent snapshot and that
`npm run build:embed` should be run "only when producing a portable embed release." The Chime
booking widget is maintained separately. Standalone work must not modify it, and must not leak
into its build.

Phase 0 initially violated this in two ways. Both are corrected.

**1. Widget source was edited to satisfy a typecheck error.** `src/embed.tsx` and
`src/types/widget.ts` had `mount()` widened from `HTMLElement` to `Element`. Reverted in
`a5a2d6a`. The two files are now byte-identical to their pre-Phase-0 state apart from the
`mountConfiguredElement` call that was already in the working tree. The type edits were erased at
compile time, so no emitted output was affected — verified by building the reverted source and
comparing hashes against `dist-embed/`: **both `chime-widget.js` and `chime-widget.css` are
byte-identical.**

**2. A root `.env.local` would have inlined an admin token into the widget bundle.** This is the
more serious one. Vite loads root `.env*` files for *every* config in the project, including
`vite.embed.config.ts`. A `VITE_CHIME_ADMIN_TOKEN` in the repository root therefore ends up
compiled into `dist-embed/chime-widget.js` — the customer-facing bundle that gets copied onto
public websites. A live owner session token would have shipped with it.

Fixed by scoping administrator configuration away from the root:

- `vite.admin.config.ts` sets `envDir: config/admin`
- the file moved to `config/admin/.env.local`, gitignored via `config/admin/.env*`
- verified by building the embed to a scratch directory and grepping: zero occurrences of
  `VITE_CHIME_ADMIN_TOKEN`, `VITE_CHIME_ADMIN_API_URL`, the token body, or the signing secret

The `dist-embed/` in the working tree was built before `.env.local` existed and contains **no
credential** (verified: 0 occurrences). Its contents match a clean build of current source
exactly.

One caveat worth recording: `dist-embed/` had 8 entries before Phase 0 and has 3 now, because
`vite.embed.config.ts` sets `emptyOutDir: true` and a build was run against it. The 3 files are
exactly what a clean build produces. If any of the other 5 were placed there by hand rather than
generated, they are gone and will need to be restored from the widget project.

**Rule going forward:** treat `src/embed.tsx`, `src/embedPresentation.ts`, `src/types/widget.ts`,
`src/components/booking/`, `src/App.tsx`, `src/data/`, `vite.embed.config.ts`, and `dist-embed/`
as belonging to the booking widget. Standalone changes stop at `src/admin/`, `server/`,
`database/`, `scripts/`, and the admin entry points. `tsconfig.json` is currently shared by both;
splitting it is the remaining structural commingling.

### Not done, and deliberately so

- **The 6 smoke-test services and the polluted customer metadata are still in the live
  database.** Cleaning production-ish data is plan Finding #2's job and should be a deliberate
  decision, not a side effect of Phase 0. A fresh database no longer produces them.
- **`widget_configs` is still empty**, so Launch reads 75%. Whether saving a design should be
  required before publishing is a product call, and the checklist now states it clearly.
- **No migration runner yet.** Ordering is still filename-based in `docker-compose.yml`. This
  remains a Phase 1 item.

---

## Phase 1 completion (2026-08-16)

All five Phase 1 items are done, with the two amendments this review recommended.

### One resolver, not three

`src/admin/adminConnection.ts` is the only module that reads connection configuration.
`serviceStudioDirectory` had never read `VITE_CHIME_ADMIN_TOKEN` — the documented name — so a
correctly configured workspace still fell back to demo staff and **zero locations**, which is
exactly Finding #1's "Team reported zero covered locations" symptom. The team picker now renders
the three real staff with correct assignment state, and Studio A and Studio B.

`describeMissingConnection()` replaces "The durable admin API is not configured." with an
instruction naming the file and command that fixes it.

### The invented data is gone

`AdminApp` carried a second, fully hardcoded schedule — 239 lines of fake calendar plus the drag,
resize, approve and inspector machinery behind it — rendered whenever the API was unreachable.
**Which half of the product you saw depended on an environment variable.** That is the actual
mechanism behind "the workspaces do not agree."

Three quieter dishonesties went with it:

- loading services fabricated a draft when the API legitimately returned none
- saving with no connection reported "Saved for this session" and returned as though it worked
- Widget Designer reported a saved design while Launch readiness still counted zero, so two
  screens contradicted each other

`AdminApp` went from 1113 to 323 lines, and the sample-data modules were deleted outright so a
future change cannot quietly re-import them. Net across Phase 1: **1,389 lines removed.**

### Three honest states

`studioState.tsx` provides `useStudioResource` and `StudioStateNotice`. `unconfigured` is split
from `failed` because the remedies differ — one is a setup step, the other is a retry — so Retry
is only offered where retrying can work. Insights, Payments, Team, Settings and Widget Designer
were converted; Insights now withholds the dashboard rather than drawing zeros.

Verified by forcing `fetch` to reject: the failure notice appears with the underlying message,
the zeroed dashboard is hidden, and Try again restores it.

### Test records quarantined

Migration 014 classifies services, customers and appointments as `business`, `demo`, or `test`.
`GET /services` and `GET /customers` exclude `test` unless `?includeTest=true`. The six
`Smoke service …` rows no longer appear in the directory, and `admin-api-smoke.mjs` now declares
`origin: 'test'` so future runs classify themselves rather than relying on name matching. A smoke
run had also overwritten all six demo customers' metadata with "Payment Safety Test"; that
residue is stripped.

### Workspace indicator, with a real guard

The sidebar shows Demo / Test / Live on every screen, derived from whether notifications can
reach a real person and whether payments can charge a real card, and states both in plain terms
rather than relying on the label alone. A workspace whose environment cannot be confirmed says
so instead of guessing.

The plan's "Production cannot enable demo-payment identifiers" is now enforced: a server
declaring `CHIME_WORKSPACE_ENV=live` refuses to start with `CHIME_ALLOW_DEMO_PAYMENTS=true`, on
both the admin and booking APIs, so the mistake surfaces before a booking is taken.

### Still open

- ~~**No login.**~~ Done — see [Sign-in](#sign-in-2026-08-16) below.
- **No migration runner.** Ordering is still filename-based in `docker-compose.yml`, now through
  014.
- **`widget_configs` is still empty**, so Launch reads 75%.
- Phase 2 onward — navigation consolidation, Services Studio essentials/advanced split, the
  preview pattern for consequential actions, and the Messages Outbox/Templates split — is
  untouched.

---

## Sign-in (2026-08-16)

The largest gap to production is closed. Administrators sign in with a password;
there is no environment path for a token anywhere in the studio.

Migration 015 adds `chime_app.user_credentials`, separate from `users` because
credentials have a different lifecycle and because `users.auth_subject` shows an
external identity provider is the intended long-term path. Hashing is scrypt
from `node:crypto`, so no native dependency was added. Work factors travel with
each hash and can be raised later without invalidating existing passwords.

`POST /session` sits outside `requireAdminSession` and carries two independent
defenses: a per-account lockout after 5 failures for 15 minutes, and a
per-address throttle of 10 per minute in front of it. Unknown account, wrong
password, and no password set all return the same message and perform the same
work.

**No credential is stored in this repository.** `cd server && npm run
set-password` reads from stdin with echo suppressed.

### Two things that only showed up because they were checked

**A timing oracle.** The stand-in hash used when no credential exists had a
leading `$`, so it failed to parse and returned before doing any scrypt work. A
known account answered in 0.06s and an unknown one in 0.01s — enough to
enumerate accounts. The stand-in is now shaped exactly like a stored hash and
the timings match.

**The token kept shipping.** Removing the build-time token took three attempts,
and the first two looked correct:

1. A runtime guard refusing an env token in a production build — the guard
   worked, but Vite had already inlined the string into `dist-admin`.
2. Static access behind `import.meta.env.DEV` for dead-code elimination — still
   shipped, because `import.meta.env?.NAME` with optional chaining is not the
   form Vite rewrites.
3. Dropping the optional chaining — **still shipped.** The admin bundle reaches
   `src/lib/widgetConfig.ts` via Widget Designer's live preview, and that module
   does a bare `import.meta.env` read, which inlines the entire env object no
   matter how the admin side behaves. It is widget code and not ours to change.

The fix was to remove the environment token path entirely rather than guard it.
Each attempt was caught by building with a sentinel token and grepping the
output; without that check, two of them would have been reported as done.

**Consequence worth remembering: no secret may go in any `VITE_*` variable in
this project.** Recorded in `ISOLATION.md`.

### Still open after this

- ~~**No migration runner.**~~ Done — `npm run migrate` / `npm run migrate:status`,
  with a checksum ledger. See `database/README.md`.
- **`widget_configs` is still empty**, so Launch reads 75%.
- Session tokens are bearer credentials held by JavaScript, readable by an XSS
  bug. The httpOnly-cookie alternative needs CSRF protection and a same-site
  story for the embed.
- Phase 2 sections 4, 5, most of 6, 7, 8 and 9 are done. Sections 10-11 remain.

---

## Migration runner (2026-08-16)

`npm run migrate` applies pending migrations to an **existing** database and
records them in `public.chime_schema_migrations` with a sha256 of each file.
`npm run migrate:status` reports applied, pending, and edited-since-applied;
both refuse to proceed on a drifted checksum, because two databases would
otherwise silently disagree.

This closes the gap that caused the original confusion: docker-compose mounts
SQL into `/docker-entrypoint-initdb.d`, which Postgres runs **only when the data
directory is empty**, so an existing volume never received a new migration.
Migrations 014 and 015 had to be applied by hand.

### Two findings from testing against a genuinely empty database

**The migration sequence does not stand alone.** Migration 002 constrains
`public.chime_bookings`, created by `postgres-schema.sql`, which is not part of
the numbered sequence. Running migrations against an empty database fails at
002. The runner now applies it first and records it as `000`, so the
prerequisite is tracked rather than folklore.

**Seeds interleave with migrations, and that is load-bearing.** Migrations 007,
008, 011, 012 and 013 seed organization-scoped rows with
`SELECT ... FROM chime_app.organizations`, so they insert nothing unless an
organization already exists. `docker-compose.yml` runs `seed-admin-demo.sql`
between migrations 001 and 002 for this reason. Running all migrations then all
seeds produces a database with **no notification templates** — confirmed by
doing it. The explicit mount list is therefore not redundant with the runner.

### Latent multi-tenancy bug this exposed — **[FIXED, migration 016]**

Because those five migrations seed from *existing* organizations, an
organization created later receives none of those defaults. `launch_settings`
self-heals via `ensureLaunchSettings`; **notification templates do not** — there
is no runtime insert anywhere in `server/src`. A second business onboarded today
would have zero email templates. Chime is explicitly a multi-tenant product, so
this will bite on the first real second tenant. Provisioning should seed these,
not a migration. Flagged as separate work.

---

## Phase 2: navigation and services (2026-08-16)

### Navigation, plan section 4

Eleven flat destinations became the five areas the plan names — Appointments,
Business setup, Customers, Money, Booking widget — with one area open at a
time. Nothing was added or removed, and all eleven screens remain reachable.

All four completion criteria verified in the studio:

| criterion | result |
|---|---|
| no more than five primary choices | 5 |
| every icon has a visible label | 0 unlabelled controls |
| counts beside their parent area | Appointments showed 2, matching the database |
| return to Schedule in one action | the brand, present on every screen |

The badge needed real data. `AdminApp` previously had one bound to sample
appointments, which was deleted along with the rest of the invented data in
Phase 1, so there was nothing left to count. `GET /navigation/counts` returns
pending requests and failed deliveries directly — the sidebar is on every
screen and cannot depend on a particular studio being mounted, and loading two
full payloads for two integers would be wasteful. It excludes test-origin
records, so a smoke run cannot make the sidebar claim a business has work
waiting.

### Services Studio, plan section 5

The editor now has Essentials and Advanced rules, containing exactly the fields
the plan lists. Three original fieldsets mixed the two, so this is a regrouping
rather than a reordering:

| original fieldset | Essentials | Advanced |
|---|---|---|
| Timing rules | default length | shortest, longest, resize steps, buffers |
| Booking & approval | confirmation choice | schedule changes, minimum notice, book ahead |
| Team & capacity | staff, location | capacity |

Add service is now secondary and Duplicate moved into an actions menu, so the
header no longer advertises making another service above editing the current
one. The other two items in that section were already satisfied: the core
services are untouched, and automated test drafts stopped appearing when record
origins were added in Phase 1.

Round-trip verified: editing one field in each group saves and reaches the
database. The demo service was restored to its original values afterwards.

### Remaining

Plan sections 6-11: previews for consequential actions, the Messages
Outbox/Templates split, schedule safety, customer relationships, payment and
delivery reliability, and the literal-language pass.

---

## Organization provisioning (2026-08-16)

The multi-tenancy gap the migration runner exposed is closed.

`chime_app.provision_organization(uuid)` seeds notification templates, customer
tags, business settings and launch settings for one organization, and a trigger
on `chime_app.organizations` calls it — so defaults arrive however an
organization is created, rather than depending on a migration having run
afterwards. Existing organizations are backfilled. The function is idempotent.

The five earlier migrations are deliberately **not** edited to delegate to it.
They have already been applied, and `scripts/migrate.mjs` refuses to run when an
applied migration's checksum changes, precisely so two databases cannot silently
disagree. Editing them would break every existing database.

Verified by reproducing the bug and fixing it in the same database: a second
organization created without 016 received **0 templates, 0 tags, 0 settings**;
after 016 it had the full set; a third created afterwards was provisioned
automatically; and a fresh `docker-compose` initialization gives a brand-new
business all 11 templates.

### Plan section 7's escaped line breaks, fixed along the way

Migration 007 wrote its template bodies as plain SQL strings, so `\n` was stored
as the two characters backslash and n and those templates rendered as one
run-on paragraph — the "legacy escaped line breaks" item in plan section 7.
Migration 013 had used `E''` strings and was correct.

Since 016 authors the canonical template set, it uses `E''` and repairs the
existing rows, so the first tenant does not end up with worse templates than the
second. Five rows were affected in the live database; none remain.

One measurement note: the first check for this used `LIKE '%\n%'`, which in a
LIKE pattern means "contains the letter n" because backslash is the escape
character — it reported 22 affected rows out of 22. `position('\n' in ...)` is
the correct predicate and reports the real number.

---

## Predictable actions, plan section 6 (2026-08-16)

The survey found the opposite of what the section assumes. Appointment
adjustment did preview its changes, but **exactly one other action in the whole
studio confirmed anything**: a browser `confirm()` on payments reading "Are you
sure you want to refund $145.00 to Maya Kealoha?". Publishing availability,
processing the message queue, approving or declining an appointment, and opening
the widget to customers all fired on a single click.

`actionPreview.tsx` renders the six facts the plan lists. They are separate
fields rather than prose, so an action cannot quietly omit one — a caller that
says nothing about notification renders "No one is notified", which is a claim
someone will notice is wrong.

| action | previewed | notable |
|---|---|---|
| payment capture / void / refund / sync | yes | replaces the `confirm()`; each described separately because "can this be undone" genuinely differs |
| message processing | yes | names sandbox vs live, recipient count, and that a sent message cannot be recalled |
| appointment approve / decline | yes | names the customer emailed; decline requires a reason the customer sees |
| availability publication | yes | states how much of what customers can book is being replaced |
| widget publication | yes | also routed from Save changes, which could publish the hosted page |

### Completion criteria

| criterion | state |
|---|---|
| consequential actions require an outcome preview | done for the seven the plan lists |
| duplicate submissions are idempotent | already enforced — `Idempotency-Key` required on every mutation |
| conflicting edits show a comparison | done for services; other editors still show the server's message only |
| reversible actions provide Undo or a safe recovery path | **partial** — the preview *states* reversibility accurately, but there is no Undo control |
| every completed action creates an audit entry | already enforced — audit and outbox writes are transactional |

### Conflict comparison

The server already refused stale writes; the client showed that as an ordinary
error, which is safe but leaves the administrator choosing blind. A conflict on a
service now fetches the saved record and lists only the fields that differ, mine
beside theirs, with "keep editing" and "discard and load" as explicit choices.

Verified by forcing a real conflict: another session changed the short
description while the studio held an older version and had edited the price. The
notice listed exactly those two fields with both values.

### Honestly not done

**Undo.** The preview tells the truth about whether something can be taken back,
and several actions are recoverable through the interface already — a capture can
be refunded, an approval can be cancelled, a publication can be paused. But there
is no one-click Undo after the fact. Building it properly means recording the
prior state per action and a route to restore it, which is its own piece of work
rather than a tail of this one.

**Conflict comparison beyond services.** Team, availability, business settings,
launch settings and payments all detect conflicts server-side and return a clear
message, but do not yet show the comparison.

---

## Messages, plan section 7 (2026-08-16)

| item | state |
|---|---|
| Outbox and Templates tabs | done — one pane at a time; the template editor gets full width |
| Process ready renamed to a concrete outcome | done — "Send 8 queued messages" live, "Process 8 in sandbox" otherwise, disabled when empty |
| Send test to myself before activation | done — new endpoint, rendered result shown in the studio |
| Legacy escaped line breaks | done earlier, in migration 016 |
| Plain-text fallback for every HTML email | already present — `body_template` is required, `body_html` optional |
| Server-side HTML sanitization | **a live bypass was found and closed** — see below |
| Alt text and size limits for newsletter images | done, and the limits were made reachable |
| Show recipient, subject and rendered message before sending | done for both the queue preview and the template test |

### The sanitizer had a live bypass

Testing the existing sanitizer against the attacks this section names found one:
the `javascript:` rule required the attribute to be quoted, so
`<a href=javascript:alert(1)>` with no quotes went straight through into stored
newsletter HTML.

`href` and `src` are now rewritten through an **allowlist of permitted schemes**
rather than a blocklist of forbidden ones, handling quoted and unquoted values
alike. Enumerating what is safe cannot be bypassed by finding a scheme nobody
thought to ban. Verified through the API: unquoted and quoted `javascript:`,
`vbscript:`, and a base64 `data:text/html` payload all become `href="#"`, and
`svg` is stripped entirely.

The sanitizer is still pattern-based, which is now stated in the code. A parser
would be more durable and is the right fix if imported HTML ever comes from a
less trusted source than an administrator.

### The size limits were unreachable

A 512 KB inline-image limit and the pre-existing 2.5 MB HTML limit could never
fire: the admin API caps request bodies at **96 KB**, so body-parser rejected
anything that large first and the administrator saw a bare `INTERNAL_ERROR`.
Both limits now sit below the transport cap where they can actually trigger, and
an oversized request returns 413 naming the cap. This is a good example of a
check that would have been reported as working without being tested against a
real request.

### Test send

The recipient comes from the session, never the request body — verified by
trying to override it. It queues a real delivery rather than simulating one, so
it honours sandbox or live mode, and `render`/`renderHtml` are now exported from
the notification service and used directly, because a preview that substitutes
placeholders differently from the real sender is not a test of anything.

Verified: repeat calls with one `Idempotency-Key` create a single delivery, and
saving a template creates no deliveries at all.

---

## Schedule safety, plan section 8 (2026-08-16)

Two of the five completion criteria were already met by the server, and one no
longer applies in the form the plan assumed.

| criterion | state |
|---|---|
| a staff member cannot be double-booked | already enforced — `tstzrange` overlap on the write path |
| required buffers cannot be violated silently | already enforced — the same query counts each service's buffers on both sides |
| resize and drag work with mouse, touch and keyboard | **no drag surface exists** — see below |
| approval status visible without opening another screen | already met — cards show "Needs approval" |
| every change traceable to an administrator and timestamp | already met — `audit_events` |

### What was actually missing

Conflicts were only reported **on submit**. An administrator learned the time
was taken after committing to it. `findScheduleConflicts` is now extracted from
the write path and answers both questions — the check made while a time is being
chosen, and the guard that refuses the write.

Sharing one function matters more than it looks: a separate implementation for
the preview would drift from the one that enforces, and the preview would start
lying. `POST /appointments/:id/change-requests/check` writes nothing and returns
the colliding appointments; the studio calls it as the draft changes and lists
them inline. A failed check does not block the form, since the write path
enforces the rule regardless.

The change request also goes through the action preview now, showing old beside
new for **only the fields that differ**, naming the customer who will be
emailed, and stating whether their approval is required.

### The keyboard criterion no longer applies as written

There is no drag or resize surface to make accessible. That machinery belonged
to the hardcoded sample calendar deleted in Phase 1; the real studio changes an
appointment through form controls, which are keyboard-operable by construction.

Verified rather than assumed: every control in the change form is
keyboard-reachable, the duration control is a range input (arrow-key operable),
there are zero `draggable` or mouse-only elements, and appointment cards are
buttons.

### Verified against the seeded schedule

Moving an appointment onto another staff member's booked hour reports the
conflict by reference code and customer. A time **five minutes after that
booking ends still conflicts**, because the service requires 5 minute buffers on
each side — which is exactly the "buffers cannot be violated silently" criterion
made visible. A clear time reports none.

---

## Customer relationships, plan section 9 (2026-08-16)

| criterion | state |
|---|---|
| customers created by bookings appear automatically | already met — verified in Phase 0 via the widget projection |
| duplicate profiles can be safely merged | done — detection, merge, and a studio banner |
| communication consent is visible before outreach | already met — the profile carries all four consent fields |
| sensitive notes are permission-controlled and audited | permission-controlled already; **auditing added** |
| customer history links to appointments and payments | appointments already; **payments added** |

### Duplicates and merge

Migration 017 adds generated, indexed `normalized_email` and `normalized_phone`.
Generated rather than maintained in application code, so they cannot drift from
the values they normalize.

Phone reduces to the **last ten digits**, so `+1 (808) 555-0123` and
`808-555-0123` produce one key rather than differing by a country code. That is
a deliberate tradeoff recorded in the migration: two international numbers could
in principle share their last ten, which is acceptable because this only
*suggests* a duplicate. Merging is always an explicit human decision.

`chime_app.merge_customers()` moves every referencing row before deleting the
duplicate. All **eleven** tables with a foreign key to customers are handled
explicitly — relying on `ON DELETE CASCADE` would destroy the duplicate's notes,
tags and action tokens rather than preserve them, which is the opposite of
merging. Consent takes the **more restrictive** of the two records, since
someone who opted out on one has not agreed on the other.

Verified on a throwaway database that a duplicate carrying an appointment, a
note, a tag and opposite consent merged leaving **zero orphaned references
across all eleven tables**, and again end to end through the studio.

### A pre-existing bug this uncovered

`AdminApiClient.request` did not set `Content-Type`, leaving every caller to
remember it. **Six did not**: creating a customer note, creating a customer,
updating a customer, creating a tag, assigning tags, and saving an availability
schedule. Without the header `express.json` never parses the body, the server
sees an empty request, and it surfaces as a 500 far from the cause. Confirmed
directly — the same note request returns **500 without the header and 201 with
it**.

Fixed centrally: `request` now defaults the header whenever a body is present.

This only came to light because my own merge call had the identical flaw and I
audited for others after fixing it. It is a good argument for defaults living in
one place rather than being a convention each caller is trusted to follow.

### Also worth noting

A duplicate-scan effect was written and referenced but **never wired to run on
mount**, so the banner never appeared on first load. The insertion script had
reported a "fallback" path that silently matched nothing — a reminder that a
script reporting success is not evidence the change landed.

## Payment and delivery reliability, plan section 10 (2026-08-16)

| criterion | state |
|---|---|
| a booking that requires payment cannot complete unpaid | already met — verified |
| the same payment cannot be applied twice | already met — verified |
| a failed message can be retried without duplicating it | already met — verified |
| refunds, voids and suppressions record who and why | **added** |
| the payment ledger connects to appointments and customers | already met — verified |

Four of the five criteria were already satisfied. That is worth stating plainly:
this section was mostly verification, and most of what it verified held up.

### What was verified rather than built

A booking against a service requiring payment, submitted with no payment intent,
returns **402 and writes no rows** — not an appointment, not a hold.

The same payment intent submitted for a second appointment returns **409, "That
payment has already been used for another appointment"**, leaving one booking,
one hold and one payment.

`chime_app.payments.appointment_id` is `NOT NULL` with a foreign key, so a
payment cannot exist detached from the appointment it paid for, and reaches the
customer through it. The ledger is connected by the schema rather than by
convention.

Message retry **updates the existing delivery row** rather than inserting a
second one, so a retried message is one message with a higher attempt count.

Crashed-worker recovery was proven rather than assumed: a delivery left in
`processing` with a ten-minute-old claim was reclaimed by the next pass and
sent, with `attempt_count` going 1 → 2. A worker dying mid-send does not strand
a customer's message forever.

### What was missing

`payment_actions` recorded who and when, but `reason` was nullable and the API
accepted an empty string. Suppressing a delivery recorded **nothing at all** —
the row simply changed status, with no trace of who stopped it or why.

These are exactly the actions someone asks about months later: a customer
disputes a refund, or asks why they never got a confirmation. "Who and why" is
only useful if the why cannot be skipped.

Migration 018 makes `reason` `NOT NULL` on `payment_actions` and adds a check
requiring at least three non-blank characters for `refund` and `void`. `capture`
and `sync` are exempt — they move no money away from the business. Suppression
gains `suppressed_reason`, `suppressed_by_user_id` and `suppressed_at`, with a
check that a suppressed row must carry a reason.

Existing rows are backfilled with "Recorded before reasons were required" rather
than a plausible-sounding invention. Saying nobody recorded it is more honest
than fabricating what they would have written.

### Enforced in three places, deliberately

The studio prompts for a reason and keeps the confirm button disabled until
three characters are typed. The API rejects a reasonless refund, void or
suppression with `REASON_REQUIRED`. The database refuses the row regardless of
caller.

A prompt is not enforcement — it only governs the one path that renders it.
Verified all three independently: the API returns `REASON_REQUIRED` for a
reasonless refund and accepts the same refund with a reason; and going around
the API entirely, the constraints still reject a reasonless refund and a
reasonless suppression, while correctly allowing `capture`.

### Also worth noting

Migration 017, added in section 9, was **never mounted in `docker-compose.yml`**
— it had been applied to the running database by the migration runner, so
everything worked locally while a fresh database would have come up without it.
Both 017 and 018 are now mounted, and a throwaway container built from the
compose mounts alone comes up with **41 tables, `merge_customers`, both new
constraints, and zero errors**.

This is the failure mode the migration ledger exists to catch and did not: the
runner tracks what has been applied, not what a new machine would get.

## Literal language, plan section 11 (2026-08-16)

The plan asks for direct primary headings, with the warmer brand language kept
as supporting copy underneath. It names eleven: Appointments, Requests,
Messages, Services, Team, Availability, Customers, Payments, Insights, Widget
Designer, Launch.

The sidebar was already literal. The page headings were not.

| screen | heading before | heading now |
|---|---|---|
| Customers | Know the person, not just the appointment. | Customers |
| Messages | Every message, visible and under control. | Messages |
| Availability | Shape the week by sight. | Availability |
| Widget designer | Make booking feel like your business. | Widget designer |
| Launch | Launch Chime anywhere | Launch |
| Services | Services studio | Services |
| Team | Team studio | Team |

Nothing was deleted. Every stylized headline moved down one level and now opens
the sentence beneath the title — "Availability / Shape the week by sight. Drag
shifts, pull their edges…". The warmth survives; it just stops being the only
thing a first-time user has to work from.

Verified in the running studio rather than by reading source: all eleven
headings render as the plan's words, and each matches the sidebar entry that
leads to it.

### The kicker above each title now says where you are

It used to be decoration — "No-code setup", "Business pulse", "Portable
booking", "Customer deposits". It now names the navigation area the screen
lives in, so the header reads as a location: **Business setup / Services**,
**Money / Payments**, **Booking widget / Launch**.

Two screens dropped it entirely. Appointments and Customers are both the area
*and* the screen, and printing the same word twice reads as a bug rather than
as a breadcrumb.

### Buttons that named a mechanism now name an outcome

| before | now | why |
|---|---|---|
| Suppress | Stop this message | "Suppress" is a delivery-system word |
| Retry | Send again | says what the customer receives |
| Void | Release the hold | says what happens to the card |
| Add | Add tag | "Add" alone did not say what |

The delivery status filter read **Suppressed**; it now reads **Stopped**. The
filter keys are still the statuses the database stores — only the labels
changed, and they are now written out explicitly rather than derived by
capitalising the status value, which is what put database vocabulary on screen
in the first place.

The confirmation dialog was already literal — "Stop this message being sent" —
so the old **Suppress** button disagreed with its own dialog. It also described
the undo path as "with Retry", naming a button that no longer exists under that
name. Both now match.

One more inconsistency fixed while checking this: the dialog showed the raw
status, so it read "failed → Suppressed" while the row beside it said "Needs
attention". It now reads **Needs attention → Stopped**.

### A layout bug this caused

`.payments-action-row` was `grid-template-columns: 1fr 85px`. Eighty-five pixels
fit the word "Void" and nothing longer, so "Release the hold" broke across two
lines inside a 38px-tall button. The panel is only ~286px wide, so no phrase
would have fit beside the primary action.

The row now stacks, giving each action the full width, and the buttons carry
`white-space: nowrap` so a label naming an outcome can never break mid-phrase.
Measured in the browser afterwards: both buttons 286px, one line each, nothing
clipped.

Worth noting because it is the predictable cost of this section — a fixed width
chosen for a one-word label is a constraint on the vocabulary, and changing the
words means checking the space they were given.
