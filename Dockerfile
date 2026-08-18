# Chime — one image, three entry points.
#
# The customer API, the administrator API and the notification worker are the
# same compiled server started differently, so they ship as one image rather
# than three that could drift apart. The static front ends are built here too
# and copied out by the compose file, so a release is one build.
#
#   node dist/index.js               customer booking API
#   node dist/admin/index.js         administrator API
#   node dist/notifications/worker.js  delivery worker

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --no-audit --no-fund \
 && npm --prefix server ci --no-audit --no-fund

COPY . .

# The server compiles to dist/. The front ends build to dist-admin/ and
# dist-embed/. The embed build empties dist-embed, which is why it runs here on
# a clean checkout rather than against a working tree someone is using.
RUN npm --prefix server run build \
 && npm run build:admin \
 && npm run build:embed \
 && npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. The build tooling has done its job.
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/database ./database
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
# Built front ends, so one image can also serve or export them.
COPY --from=build /app/dist-admin ./dist-admin
COPY --from=build /app/dist-embed ./dist-embed
COPY --from=build /app/dist ./dist

# Runs as a non-root user. The node image ships one.
USER node

# Overridden per service in compose; the customer API is the sensible default.
CMD ["node", "server/dist/index.js"]
