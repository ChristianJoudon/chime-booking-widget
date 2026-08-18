# Chime Standalone Isolation

This folder is an independent source snapshot of the Chime booking product.

- It lives outside the HiTech Labs website repository.
- The HiTech website does not import, serve, or deploy files from this folder.
- Private environment files, installed dependencies, generated builds, IDE state,
  and Git metadata were intentionally excluded.
- The existing HiTech website and its deployed Chime bundle were not changed.
- Changes here affect only this standalone copy unless someone deliberately builds
  the embed and copies its output into another project.

Several other Chime checkouts exist on this machine. Nothing in this folder may
share a name, a port, a Docker resource, or a build artifact with any of them.

## Identity

Everything that names this copy is unique to it and does not derive from the
folder name, so duplicating or renaming the directory cannot cause a collision.

| | value |
|---|---|
| root package | `chime-standalone` |
| server package | `chime-standalone-server` |
| Compose project | `chime-standalone` (pinned in `docker-compose.yml`) |
| Postgres container | `chime-standalone-db` |
| Postgres volume | `chime-standalone_chime-standalone-db-data` |

## Ports

This copy owns a dedicated block. None of these are Vite or Postgres defaults,
and every dev server sets `strictPort` so a clash fails loudly instead of
silently sliding onto a neighbouring port.

| service | port | command |
|---|---|---|
| Postgres | 5534 | `docker compose up -d` |
| customer booking API | 8887 | `cd server && npm run dev` |
| administrator API | 8888 | `cd server && npm run dev:admin` |
| booking dev server | 5373 | `npm run dev` |
| admin studio | 4374 | `npm run dev:admin` |
| customer approval | 4375 | `npm run dev:approval` |

Vite binds IPv6, so the studio is at `http://localhost:4374` — `127.0.0.1:4374`
will not connect. Both origins are in `CHIME_ADMIN_ALLOWED_ORIGINS`.

## Credentials

Administrator configuration lives in `config/admin/.env.local`, **not** in the
repository root, and `vite.admin.config.ts` points `envDir` at it.

This matters more than it looks. Vite loads root `.env*` files for every config
in the project, including `vite.embed.config.ts`. A `VITE_CHIME_ADMIN_TOKEN` in
the root is therefore compiled into `dist-embed/chime-widget.js` — the
customer-facing bundle that gets copied onto public websites. Scoping `envDir`
keeps administrator credentials out of every widget build.

Administrators sign in with a password; there is no environment path for a
token at all. `POST /api/chime/admin/session` issues a short-lived session,
held in `sessionStorage` for the life of the tab.

**Never put a secret in a `VITE_*` variable in this project.** The admin bundle
reaches `src/lib/widgetConfig.ts` through Widget Designer's live preview, and
that module does a bare `import.meta.env` read, which makes Vite inline the
*entire* env object — every `VITE_*` value — into the built JavaScript as a
plain object literal. Careful handling on the admin side does not help: a
`import.meta.env.DEV` guard, static property access, and dead-code elimination
were all tried against a sentinel token and it shipped every time, because a
different module pulls the object in. `widgetConfig.ts` belongs to the widget
and is not ours to change. The admin API address is the only `VITE_*` value
this studio reads, and it is public information.

## The booking widget is not ours to change

The Chime booking widget is maintained separately. Standalone work must not
modify it and must not leak into its build.

**Widget territory — do not change for standalone work:**

```
src/embed.tsx              src/App.tsx           src/components/booking/
src/embedPresentation.ts   src/data/             src/types/widget.ts
src/lib/widgetConfig.ts    vite.embed.config.ts  dist-embed/
tsconfig.json
```

**Standalone territory:**

```
src/admin/       server/src/admin/   database/   scripts/
admin.html       vite.admin.config.ts            tsconfig.admin.json
config/admin/    docs/
```

`tsconfig.json` belongs to the widget and keeps its original `ES2020` settings.
Standalone code typechecks under `tsconfig.admin.json`, which raises `lib` to
`ES2021`. `npm run typecheck` runs the standalone config; `npm run
typecheck:widget` runs the widget one.

Run `npm run build:embed` **only when producing a portable embed release**. It
sets `emptyOutDir`, so it deletes everything already in `dist-embed/`.

### One authorized exception, 2026-08-17

Widget files were changed with the owner's explicit approval, across three
requests: stop the widget inheriting the host page's text size, close the
remaining host-style conditions, then move to Shadow DOM. The files touched are
`src/index.css`, `src/embed.tsx`, `src/embedPresentation.ts`, and a new
`src/embedIsolation.ts`. See "Host-page style leakage" below for what they do
and why. `dist-embed/` was rebuilt from them.

A fourth request followed: a month/day toggle for the calendar, and less
wording on small screens. That added `src/components/calendar/CalendarView.tsx`
and `src/components/ui/ProgressSteps.tsx` (read only — its markup did not
change) to the same exception. See "Month or day, on a phone" below.

Nothing else in widget territory was touched, and nothing outside this folder
was touched — the other Chime checkouts on this machine are unaffected. The
boundary above still stands for everything else.

### The widget typecheck error, fixed 2026-08-17

`npm run typecheck:widget` used to report one error: `MountWidget` declared
`(target: string | Element)` while `mount` accepts `string | HTMLElement`.

The type was the wrong half. `mount` renders HTML into a shadow root and only
HTML elements can host one, so it genuinely cannot take any `Element` — the
declaration was a promise the implementation could not keep. `MountWidget` now
says `HTMLElement`, and `mountConfiguredElement` declines anything else by
returning the `null` its signature always allowed and nothing ever reached.

That matters more than a clean typecheck. `[data-chime-widget]` can match an
`<svg>`, which would previously have been passed to `mount`, thrown inside
`attachShadow`, and fallen back to putting a `<div>` inside the SVG. It is now
skipped, and `autoMount` counts what mounted rather than what matched.

`npm run typecheck:widget` reports no errors.

### The widget sizes itself from its container, not the window

Everything responsive in the widget keys off `@container chime-widget` and `cqi`
units rather than `@media` and `vw`. `.chime-widget` declares
`container: chime-widget / inline-size`, and the container is named so the
queries resolve to the widget root regardless of the nested container on
`.calendar-month-card`.

This matters because a viewport is the wrong question for an embedded
component. Dropped into a 700px panel on a 1400px window, the widget used to lay
itself out as a desktop and then clip: step labels cut to "Servi", a heading
sized from `3vw` of the *window* wrapping four lines deep in a narrow box. The
administrator's live preview showed it first, but any host with a sidebar or a
two-column layout got the same widget.

Only preference queries stay as `@media` — `prefers-reduced-motion` and
`prefers-reduced-transparency` ask about the person, not the box.

### Host-page style leakage

`npm run test:embed-host-styles` renders the built widget under stylesheets real
small-business sites carry. All eleven checks pass, in both directions: no host
CSS reaches the widget, and the host page is identical with and without it.

**The widget renders inside a shadow root.** Selectors in the host document do
not match anything inside one, whatever their specificity and whatever they mark
important. That makes the isolation structural rather than an agreement every
future edit has to keep.

Three things sit outside the boundary by necessity:

- **Inherited properties still cross** — font-family, font-size, line-height,
  colour, direction. The widget resets these on `.chime-widget`, inside the
  shadow, which is where its own styling begins anyway.
- **The `<dialog>` element** has to be in the host document to reach the top
  layer, and `::backdrop` belongs to it rather than to anything inside. Those
  two rules are injected into the document by `ensureDialogStyles()`, copied
  from `index.css`. If the `.chime-embed-dialog` rules there change, that
  function has to change with them.
- **`<dialog>` and `<button>` cannot host a shadow root** at all — only a fixed
  list of elements can. `isolate()` detects this with a try/catch rather than a
  copy of the browser's list, and falls back to a plain `<div>` inside the
  element. Without that fallback the modal launcher opened an empty dialog.

The CSS defences underneath — `!important` on every `font-size`, `font-family`,
`line-height`, `box-sizing`, `margin` and `padding` declaration, plus `inherit`
floors on `.chime-widget *` anchored at `.chime-widget` — are **still
load-bearing** and must not be removed. The admin studio's Widget Designer
renders the widget directly into the admin document with no shadow root, and
those rules are all that protect it there.

They also mean the two mechanisms each hold all ten style conditions
independently, so removing the shadow boundary changes none of the layout
measurements. The check asserts the boundary structurally for that reason —
without it, isolation could quietly revert to a cascade agreement and every
measurement would still pass.

Applying `!important` **uniformly** to those properties is what keeps the
widget's appearance unchanged: precedence among its own rules is then decided by
specificity and source order exactly as before. Marking a chosen few would
reshuffle the cascade. The floors tie with any single-class selector, so they
sit ahead of the widget's own rules, which all override them.

Verified by fingerprinting all 80 rendered elements before any of this work and
after all of it: one decorative element differs by a pixel.

`dist-embed/chime-widget.css` is still emitted and `embed.tsx` still imports the
stylesheet for its side effect, because embed snippets already in the wild link
that file. Nothing inside a shadow root reads it — `embedIsolation` injects its
own copy — but a 404 in a customer's console is a poor way to ship an
improvement.

### Month or day, on a phone

Below 620px of container the widget shows one thing at a time: the times for a
chosen day, or the month grid used to choose one. `‹ ›` step to the previous or
next day that actually has openings, and a button reading the month name swaps
in the grid.

The measured cost of showing both was four phone screens of scrolling to pick
one appointment — a month grid stacked on top of every time in the day. Nothing
overflowed and nothing clipped; every check pointed sideways, and the problem
was vertical. `npm run test:widget-narrow` is the check that can see it, and it
budgets each step in screens of scrolling rather than pixels.

Four things came out of that pass, in descending order of what they saved:

| | at 320px |
|---|---|
| step indicator: three stacked cards → three markers in a row | −180px |
| time slots: one 224px column → two columns | −250px |
| month grid hidden while the times are shown | −500px |
| footer's restatement of the step, and the dead month arrows | −140px |
| four duplicated lines of wording, and time labels stacked | −65px |

**The state is one boolean, and it does not know the width.** `monthOpen` means
"the customer asked to see the month", not "we are in month mode"; whether it
matters at all is decided by a container query. There is no `ResizeObserver` and
no `matchMedia` — which would be wrong anyway, since the widget sizes from its
container and not from the window.

**No gesture code.** The customer path still has zero touch handlers. A swipe is
invisible, has no keyboard equivalent, and would need somewhere to translate,
which `.chime-app-shell { overflow-x: clip }` deliberately does not provide.
Arrows work for mouse, touch, keyboard and switch control.

**Two things that are load-bearing and easy to undo by accident:**

- The new rules are **appended at the end of `src/index.css`**. Container
  queries add no specificity, so a block placed earlier loses to any later rule
  on the same selector — `.calendar-board` is re-declared at :969 and the whole
  calendar again at :1711, both after the 620px block near the top. Moving these
  rules up the file silently disables them.
- The day navigation is a **sibling of both the month card and the times**, not
  a child of either. It was in the times panel first, and opening the month took
  "Back to times" off screen along with the panel, leaving no way back except
  picking a day.

Nothing is lost by hiding the step labels at that width. The markers already
read 1 / 2 / 3 and turn to a tick, the stage heading names the step in full, and
each item still carries an sr-only "Completed / Current step / Upcoming" plus
`aria-current="step"`. Focus is caught when the grid collapses — it would
otherwise fall to the shadow root and strand a keyboard user — and the times
panel's existing live region now leads with the date, so stepping days announces
which day it reached.

Four things say the same thing twice on a phone and one of each now goes: the
header eyebrow above a logo that already carries the name, the service line
under a card that already names the service and its length, the footer's
restatement of the step the heading states at the top, and the status line's
repeat of the date directly under the date heading. Only the last needed care —
the announcement still carries the date, in an `sr-only` copy, because it fires
on every day the arrows reach and "13 openings available" is otherwise the same
sentence for all of them. Exactly one of the two is a live region.

Two thresholds in this work were measured rather than reasoned, after guesses
were wrong both times:

- The **month grid's availability count** ("3 open") comes back only above 480px
  of *card content*. It truncated to "1…" at 44px cells, and still truncated at
  56px. It stops at about 68. That query is on the card's own container, and
  container queries measure the content box, so it fires around 512px of card
  and wider still of widget.
- The **time and its label are stacked** below 620px. Side by side in a
  half-width column, "9:00 AM" broke after "9:00". Stacking made the step
  shorter, not taller, because nothing wraps any more.

### The other two steps, and what finally measured the right thing

Choosing a service and finishing the booking got the same treatment. The
reserve step was the one an owner reported they could not scroll to the end of,
and the measurement explains why: its Continue button sat **2248px down an
844px screen**, disabled until a checkbox further up had been found.

Nothing above it was the terms document, which already scrolls inside its own
439px window. It was the same appointment stated three times over — a 430px
summary card, the panel's own explanation, and a receipt — plus a "Back to
calendar" that appeared twice, once in the panel header and once beside the
action where every sub-step already has its own.

The summary is **moved below the form, not removed**: beside the form on a
desktop it is genuinely useful, and on the details and deposit steps it is the
only place the appointment is written down. Continue now sits at 1595px.

`npm run test:widget-narrow` gained the measurement that actually sees this:
**how far down the button that finishes the step is**. Page height alone would
not have caught it — reverting the fixes leaves the reserve step at 3.5 screens
against a 3.5 budget, a pass, while the action sits 3.2 screens down against
2.8. A page may be long for good reasons; a legal document is one. What a
customer cannot afford is the *action* being far away.

Two smaller things on the service step: each card stated its deposit twice, once
in a meta line that wrapped to three lines and stranded its separator
("30 min ·") and once in the pill below carrying the actual amount; and "Tap to
choose" appeared once per card beside an arrow meaning the same thing. The label
now survives only on the chosen card, where it reads "Selected".

**A third dead rule surfaced.** The reserve step's four-part stepper rendered as
"2 Cont3 Dep4 Done" at 340px. A rule to wrap it to two rows has existed near the
top of `index.css` since the beginning and has never once applied, because
`.booking-mini-stepper` is re-declared at top level further down and top level
beats a container query at any width. That is the third time this file has done
it — after `.booking-flow-grid` and `.calendar-day__status`. **Layout rules for
narrow widths belong at the end of the file, and nowhere else.**
