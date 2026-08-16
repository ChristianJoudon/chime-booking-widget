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
