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

Nothing else in widget territory was touched, and nothing outside this folder
was touched — the other Chime checkouts on this machine are unaffected. The
boundary above still stands for everything else.

### Known widget issue, deliberately not fixed here

`npm run typecheck:widget` reports one error:

```
src/embed.tsx(68,37): error TS2345: 'string | Element' is not assignable to 'string | HTMLElement'
```

`autoMount` calls `mountConfiguredElement`, whose `MountWidget` type accepts
`Element`, while `mount` accepts `HTMLElement`. This is in-progress widget work.
Resolving it is a widget decision, not a standalone one.

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
