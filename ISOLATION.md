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

`npm run build:admin` still inlines whatever token is present into
`dist-admin/`. Prefer the dev server locally, and do not deploy a build made
with a token in place.

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

### Known widget issue, deliberately not fixed here

`npm run typecheck:widget` reports one error:

```
src/embed.tsx(59,37): error TS2345: 'string | Element' is not assignable to 'string | HTMLElement'
```

`autoMount` calls `mountConfiguredElement`, whose `MountWidget` type accepts
`Element`, while `mount` accepts `HTMLElement`. This is in-progress widget work.
Resolving it is a widget decision, not a standalone one.
